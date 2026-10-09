import { describe, expect, test, vi } from "vitest";
import { runInNewContext } from "node:vm";
import worker, { type Env } from "../src/index";
import { noticesViewHtml } from "../src/notices-view";
import type { DailyBriefNotice } from "../src/generation";
import { encryptRefreshToken } from "../src/calendar-oauth";

type Role = "administrator" | "reviewer";

class AdminDatabase {
  configuration = {
    latitude: 37.3382,
    longitude: -121.8863,
    timezone: "America/Los_Angeles",
    slotsJson: '["06:30","10:30","15:00","19:00"]'
  };
  readonly roles = new Map<string, Role>([
    ["admin@example.com", "administrator"],
    ["reviewer@example.com", "reviewer"]
  ]);
  protectedReviews = [
    {
      id: 7,
      account_id: "mom" as const,
      source_key: "a".repeat(64),
      review_kind: "sensitive" as const,
      category: "school" as
        | "school"
        | "childcare"
        | "activity"
        | "household",
      summary: "Private appointment is scheduled.",
      relevant_date: "2026-10-13" as string | null,
      action: null as string | null,
      sender_organization: "School",
      confidence: 0.97,
      created_at: "2026-10-07T17:00:00.000Z",
      expires_at: "2026-10-21T17:00:00.000Z"
    }
  ];
  publishedNotices: Array<Record<string, unknown>> = [];
  encryptedRefreshTokens = new Map<string, string>();
  accountLabels = new Map([
    ["mom", "Mom"],
    ["dad", "Dad"]
  ]);
  selectedCalendars: Array<{
    account_id: "mom" | "dad";
    calendar_id: string;
    display_label: string;
  }> = [
    { account_id: "mom", calendar_id: "family", display_label: "Family" }
  ];
  gmailSenders: Array<{
    domain: string;
    kind: "school" | "childcare";
  }> = [];
  disconnectStates = new Map<
    string,
    "revocation_pending" | "cleanup_pending"
  >();
  deletedAccountArtifacts: string[] = [];
  failCleanupBatchOnce = false;
  generationErrorCode = "DAILY_BRIEF_RENDER_FAILED";
  sourceErrorCode = "CALENDAR_OAUTH_REVOKED";

  prepare(query: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      first: async <T>() => {
        if (query.includes("FROM administration_users")) {
          const role = this.roles.get(String(parameters[0]).toLowerCase());
          return (role ? { role } : null) as T | null;
        }
        if (query.includes("FROM dashboard_configuration")) {
          return {
            latitude: this.configuration.latitude,
            longitude: this.configuration.longitude,
            timezone: this.configuration.timezone,
            slots_json: this.configuration.slotsJson
          } as T;
        }
        if (query.includes("MAX(last_check_in_at)")) {
          return { last_check_in_at: "2026-10-07T16:00:00.000Z" } as T;
        }
        if (query.includes("FROM current_render_generation")) {
          return {
            generation_id: "generation-20261007T150000Z",
            published_at: "2026-10-07T15:00:00.000Z"
          } as T;
        }
        if (
          query.includes("encrypted_refresh_token") &&
          query.includes("WHERE account_id = ?")
        ) {
          const token = this.encryptedRefreshTokens.get(String(parameters[0]));
          return (token
            ? {
                account_id: parameters[0],
                encrypted_refresh_token: token,
                oauth_status: "connected",
                gmail_disconnect_state:
                  this.disconnectStates.get(String(parameters[0])) ?? null
              }
            : this.disconnectStates.has(String(parameters[0]))
              ? {
                  account_id: parameters[0],
                  encrypted_refresh_token: null,
                  oauth_status: "disconnected",
                  gmail_disconnect_state: this.disconnectStates.get(
                    String(parameters[0])
                  )
                }
              : null) as T | null;
        }
        if (query.includes("FROM scheduled_generation_slots")) {
          return {
            slot_key: "2026-10-07T19:00",
            status: "failed",
            attempt_count: 1,
            retry_at: "2026-10-07T19:15:00.000Z",
            error_code: this.generationErrorCode
          } as T;
        }
        if (
          query.includes("FROM gmail_protected_reviews") &&
          query.includes("WHERE id = ?")
        ) {
          return (this.protectedReviews.find(
            ({ id }) => id === Number(parameters[0])
          ) ?? null) as T | null;
        }
        return null;
      },
      all: async <T>() => {
        if (query.includes("FROM gmail_protected_reviews")) {
          return { results: this.protectedReviews } as unknown as D1Result<T>;
        }
        if (query.includes("FROM calendar_accounts")) {
          return {
            results: ([
              {
                account_id: "dad",
                display_label: this.accountLabels.get("dad"),
                oauth_status: "connected",
                gmail_scan_completed_at: "2026-10-07T16:00:00.000Z",
                gmail_disconnect_state: null
              },
              {
                account_id: "mom",
                display_label: this.accountLabels.get("mom"),
                oauth_status: "revoked",
                gmail_scan_completed_at: null,
                gmail_disconnect_state: null
              }
            ] as unknown as T[])
          } as D1Result<T>;
        }
        if (query.includes("FROM selected_calendars")) {
          return { results: this.selectedCalendars as unknown as T[] } as D1Result<T>;
        }
        if (query.includes("FROM gmail_sender_allowlist")) {
          return { results: this.gmailSenders as unknown as T[] } as D1Result<T>;
        }
        if (query.includes("FROM source_status")) {
          return {
            results: [
              {
                source: "weather",
                state: "fresh",
                last_success_at: "2026-10-07T15:00:00.000Z",
                error_code: null
              },
              {
                source: "calendar",
                state: "error",
                last_success_at: "2026-10-07T10:30:00.000Z",
                error_code: this.sourceErrorCode
              }
            ]
          } as D1Result<T>;
        }
        if (query.includes("FROM operational_status")) {
          return {
            results: [{ status_key: "ai_quota", status_value: "available" }]
          } as D1Result<T>;
        }
        if (query.includes("FROM operational_incidents")) {
          return {
            results: [
              {
                error_code: "CALENDAR_OAUTH_REVOKED",
                occurred_at: "2026-10-07T16:30:00.000Z",
                notified_at: "2026-10-07T16:30:05.000Z"
              }
            ]
          } as D1Result<T>;
        }
        return { results: [] } as unknown as D1Result<T>;
      },
      run: async () => {
        if (query.includes("UPDATE dashboard_configuration")) {
          this.configuration.latitude = Number(parameters[0]);
          this.configuration.longitude = Number(parameters[1]);
          this.configuration.slotsJson = String(parameters[2]);
        }
        if (
          query.includes("UPDATE calendar_accounts") &&
          query.includes("SET display_label")
        ) {
          this.accountLabels.set(String(parameters[1]), String(parameters[0]));
        }
        if (query.includes("INSERT INTO selected_calendars")) {
          this.selectedCalendars.push({
            account_id: parameters[0] as "mom" | "dad",
            calendar_id: String(parameters[1]),
            display_label: String(parameters[2])
          });
        }
        if (query.includes("INSERT INTO gmail_sender_allowlist")) {
          this.gmailSenders.push({
            domain: String(parameters[0]),
            kind: parameters[1] as "school" | "childcare"
          });
        }
        if (
          query.includes("UPDATE gmail_protected_reviews") &&
          query.includes("SET category")
        ) {
          const review = this.protectedReviews.find(
            ({ id }) => id === Number(parameters[5])
          );
          if (review) {
            review.category = parameters[0] as typeof review.category;
            review.summary = String(parameters[1]);
            review.relevant_date = parameters[2] as string | null;
            review.action = parameters[3] as string | null;
            review.sender_organization = String(parameters[4]);
          }
        }
        if (query.includes("INSERT INTO household_notices")) {
          this.publishedNotices.push({
            accountId: parameters[0],
            sourceKey: parameters[1],
            category: parameters[2],
            summary: parameters[3],
            relevantDate: parameters[4],
            action: parameters[5],
            senderOrganization: parameters[6]
          });
        }
        if (query.includes("DELETE FROM gmail_protected_reviews")) {
          this.protectedReviews = this.protectedReviews.filter(
            ({ id }) => id !== Number(parameters[0])
          );
          this.deletedAccountArtifacts.push("gmail_protected_reviews");
        }
        if (query.includes("DELETE FROM selected_calendars")) {
          if (parameters.length > 0) {
            this.selectedCalendars = this.selectedCalendars.filter(
              ({ account_id }) => account_id !== parameters[0]
            );
          }
          this.deletedAccountArtifacts.push("selected_calendars");
        }
        if (query.includes("DELETE FROM gmail_sender_allowlist")) {
          this.gmailSenders = [];
        }
        if (query.includes("DELETE FROM calendar_snapshots")) {
          this.deletedAccountArtifacts.push("calendar_snapshots");
        }
        if (query.includes("DELETE FROM household_notices")) {
          this.deletedAccountArtifacts.push("household_notices");
        }
        if (query.includes("DELETE FROM gmail_review_records")) {
          this.deletedAccountArtifacts.push("gmail_review_records");
        }
        if (query.includes("DELETE FROM render_generations")) {
          this.deletedAccountArtifacts.push("render_generations");
        }
        if (
          query.includes("UPDATE calendar_accounts") &&
          query.includes("oauth_status = 'connected'")
        ) {
          this.encryptedRefreshTokens.set(
            String(parameters[1]),
            String(parameters[0])
          );
        }
        if (
          query.includes("UPDATE calendar_accounts") &&
          query.includes("encrypted_refresh_token = NULL")
        ) {
          this.encryptedRefreshTokens.delete(String(parameters[0]));
          this.disconnectStates.set(String(parameters[0]), "cleanup_pending");
          this.deletedAccountArtifacts.push("calendar_account_credentials");
        }
        if (
          query.includes("UPDATE calendar_accounts") &&
          query.includes("gmail_disconnect_state = 'revocation_pending'")
        ) {
          this.disconnectStates.set(
            String(parameters[0]),
            "revocation_pending"
          );
        }
        if (
          query.includes("UPDATE calendar_accounts") &&
          query.includes("gmail_disconnect_state = NULL")
        ) {
          this.disconnectStates.delete(String(parameters[0]));
        }
        return { success: true };
      }
    };
    return statement;
  }

  async batch(statements: D1PreparedStatement[]) {
    if (
      this.failCleanupBatchOnce &&
      statements.length >= 6
    ) {
      this.failCleanupBatchOnce = false;
      throw new Error("D1 unavailable");
    }
    return Promise.all(
      statements.map((statement) =>
        (statement as unknown as { run(): Promise<unknown> }).run()
      )
    );
  }
}

function env(
  database = new AdminDatabase(),
  overrides: Partial<Env> = {}
): Env {
  return {
    DB: database as unknown as D1Database,
    IMAGES: {} as R2Bucket,
    BROWSER: {} as Fetcher,
    GENERATION_SECRET: "generation-secret",
    DEVICE_ORIGIN: "https://dashboard-device.example.com",
    ADMIN_ORIGIN: "https://dashboard-admin.example.com",
    ...overrides
  };
}

function accessHeaders(email: string) {
  return {
    "Cf-Access-Authenticated-User-Email": email,
    "Cf-Access-Jwt-Assertion": "validated-by-cloudflare-access"
  };
}

type DocumentListener = (event: {
  currentTarget: FakeElement;
  target: FakeElement;
  preventDefault(): void;
  returnValue?: string;
}) => unknown;

class FakeElement {
  className = "";
  dataset: Record<string, string> = {};
  disabled = false;
  checked = false;
  hidden = true;
  id = "";
  latitude!: FakeElement;
  longitude!: FakeElement;
  slots!: FakeElement;
  householdLabel!: FakeElement;
  filter!: FakeElement;
  name = "";
  value = "";
  textContent = "";
  children: FakeElement[] = [];
  controls = new Map<string, FakeElement>();
  listeners = new Map<string, DocumentListener[]>();

  addEventListener(type: string, listener: DocumentListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  async emit(type: string, target = this) {
    const event = {
      currentTarget: this,
      target,
      preventDefault() {}
    };
    await Promise.all(
      (this.listeners.get(type) ?? []).map((listener) => listener(event))
    );
  }

  set innerHTML(value: string) {
    if (value.includes('name="domain"')) {
      const domain = new FakeElement();
      domain.name = "domain";
      domain.value = value.match(/value="([^"]*)"/)?.[1] ?? "";
      const kind = new FakeElement();
      kind.name = "kind";
      const remove = new FakeElement();
      this.controls.set("input", domain);
      this.controls.set('[name="domain"]', domain);
      this.controls.set("select", kind);
      this.controls.set('[name="kind"]', kind);
      this.controls.set("[data-remove]", remove);
      return;
    }
    const calendar = new FakeElement();
    calendar.name = "calendar";
    calendar.value = value.match(/name="calendar" value="([^"]*)"/)?.[1] ?? "";
    const label = new FakeElement();
    label.name = "calendarLabel";
    label.value =
      value.match(/name="calendarLabel"[^>]*value="([^"]*)"/)?.[1] ?? "";
    const description = new FakeElement();
    description.textContent = value.match(/<span>(.*?)<\/span>/)?.[1] ?? "";
    this.controls.set('[name="calendar"]', calendar);
    this.controls.set('[name="calendarLabel"]', label);
    this.controls.set("span", description);
  }

  querySelector(selector: string) {
    return this.controls.get(selector) ?? null;
  }

  querySelectorAll(selector: string) {
    if (selector === ".calendar-row") {
      return this.children.filter(({ className }) => className === "calendar-row");
    }
    if (selector === "input,select,button") {
      return [...this.controls.values()];
    }
    return [];
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  append(child: FakeElement) {
    this.children.push(child);
  }

  remove() {}
}

async function loadAdministrationDocument(
  role: Role,
  overrides: {
    discovery?: Response;
  } = {}
) {
  const scriptResponse = await worker.fetch(
    new Request("https://dashboard-admin.example.com/admin/app.js", {
      headers: accessHeaders(`${role === "administrator" ? "admin" : "reviewer"}@example.com`)
    }),
    env()
  );
  const weatherForm = new FakeElement();
  weatherForm.id = "weather-form";
  weatherForm.controls.set("output", new FakeElement());
  weatherForm.controls.set("latitude", new FakeElement());
  weatherForm.controls.set("longitude", new FakeElement());
  weatherForm.controls.set("slots", new FakeElement());
  Object.assign(weatherForm, {
    latitude: weatherForm.controls.get("latitude"),
    longitude: weatherForm.controls.get("longitude"),
    slots: weatherForm.controls.get("slots")
  });
  const gmailForm = new FakeElement();
  gmailForm.id = "gmail-form";
  gmailForm.controls.set("output", new FakeElement());
  const senders = new FakeElement();
  const gmailAccounts = new FakeElement();
  const status = new FakeElement();
  const review = new FakeElement();
  const oauthBanner = new FakeElement();
  const forms = (["mom", "dad"] as const).map((accountId) => {
    const form = new FakeElement();
    form.dataset.account = accountId;
    form.controls.set("[data-account-status]", new FakeElement());
    form.controls.set("[data-discovery-status]", new FakeElement());
    form.controls.set("[data-calendars]", new FakeElement());
    form.controls.set("output", new FakeElement());
    form.controls.set("householdLabel", new FakeElement());
    form.controls.set("filter", new FakeElement());
    Object.assign(form, {
      householdLabel: form.controls.get("householdLabel"),
      filter: form.controls.get("filter")
    });
    return form;
  });
  const refreshButtons = forms.map((form) => {
    const button = new FakeElement();
    button.dataset.refresh = form.dataset.account;
    return button;
  });
  const bySelector = new Map<string, FakeElement>([
    ["#weather-form", weatherForm],
    ["#gmail-form", gmailForm],
    ["#senders", senders],
    ["#gmail-accounts", gmailAccounts],
    ["#status", status],
    ["#gmail-review", review],
    ["#oauth-banner", oauthBanner]
  ]);
  for (const form of forms) {
    bySelector.set(`[data-account="${form.dataset.account}"]`, form);
  }
  const document = {
    body: { dataset: { role } },
    querySelector: (selector: string) => bySelector.get(selector) ?? null,
    querySelectorAll: (selector: string) => {
      if (selector === ".calendar-form") return forms;
      if (selector === ".sender-row") return senders.children;
      if (selector === "[data-refresh]") return refreshButtons;
      return [];
    },
    createElement: () => new FakeElement()
  };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses: Record<string, unknown> = {
    "/admin/weather-configuration": {
      latitude: 37.3382,
      longitude: -121.8863,
      slots: ["06:30", "10:30", "15:00", "19:00"]
    },
    "/admin/calendar-configuration": {
      accounts: [
        {
          accountId: "mom",
          displayLabel: "Mom",
          connected: false,
          reconnectRequired: true,
          calendars: [{ id: "family", label: "Family" }]
        },
        {
          accountId: "dad",
          displayLabel: "Dad",
          connected: true,
          calendars: []
        }
      ]
    },
    "/admin/gmail-configuration": {
      senders: [{ domain: "saved.example.org", kind: "school" }],
      accounts: []
    },
    "/admin/status": {},
    "/admin/gmail-review": []
  };
  const windowListeners = new Map<string, DocumentListener>();
  runInNewContext(await scriptResponse.text(), {
    document,
    Response,
    URL,
    location: {
      href: "https://dashboard-admin.example.com/admin",
      pathname: "/admin",
      assign() {}
    },
    history: { replaceState() {} },
    confirm: () => true,
    queueMicrotask,
    addEventListener: (type: string, listener: DocumentListener) => {
      windowListeners.set(type, listener);
    },
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      if (url.startsWith("/admin/calendar/discovery")) {
        return overrides.discovery ?? Response.json({ calendars: [] });
      }
      return Response.json(responses[url] ?? {});
    }
  });
  await vi.waitFor(() => {
    expect(senders.children).toHaveLength(1);
  });
  return {
    forms,
    gmailForm,
    refreshButtons,
    requests,
    senders,
    weatherForm,
    windowListeners
  };
}

describe("Access-protected browser administration", () => {
  test("authorized users receive a browser administration surface", async () => {
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin", {
        headers: accessHeaders("admin@example.com")
      }),
      env()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Configuration");
    await expect(
      (
        await worker.fetch(
          new Request("https://dashboard-admin.example.com/admin", {
            headers: accessHeaders("admin@example.com")
          }),
          env()
        )
      ).text()
    ).resolves.toContain("Disconnect Mom Google");
    expect(
      (
        await worker.fetch(
          new Request("https://dashboard-admin.example.com/admin/app.js", {
            headers: accessHeaders("admin@example.com")
          }),
          env()
        )
      ).status
    ).toBe(200);
  });

  test("administration presents independent structured configuration sections without a raw Google editor", async () => {
    const administrator = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin", {
        headers: accessHeaders("admin@example.com")
      }),
      env()
    );
    const reviewer = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin", {
        headers: accessHeaders("reviewer@example.com")
      }),
      env()
    );

    const administratorHtml = await administrator.text();
    expect(administratorHtml).toContain("Weather");
    expect(administratorHtml).toContain("Household Label");
    expect(administratorHtml).toContain("Calendar Label");
    expect(administratorHtml).toContain("Sender-Domain Allowlist");
    expect(administratorHtml).toContain("Save weather");
    expect(administratorHtml).toContain("Save Mom calendars");
    expect(administratorHtml).toContain("Save Sender-Domain Allowlist");
    expect(administratorHtml).not.toContain("<textarea name=\"google\"");

    const reviewerHtml = await reviewer.text();
    expect(reviewerHtml).toContain("data-read-only=\"true\"");
    expect(reviewerHtml).not.toContain("data-connect=");
    expect(reviewerHtml).not.toContain("data-disconnect=");
  });

  test("saving a calendar section preserves another section's unsaved draft and dirty warning", async () => {
    const { forms, gmailForm, senders, windowListeners } =
      await loadAdministrationDocument("administrator");
    const gmailDraft = senders.children[0].querySelector("input");
    expect(gmailDraft).not.toBeNull();
    gmailDraft!.value = "draft.example.org";
    await gmailForm.emit("input", gmailDraft!);

    await forms[0].emit("submit");

    expect(senders.children[0].querySelector("input")?.value).toBe(
      "draft.example.org"
    );
    const preventDefault = vi.fn();
    windowListeners.get("beforeunload")?.({
      currentTarget: new FakeElement(),
      target: new FakeElement(),
      preventDefault
    });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  test("saving Gmail preserves an unsaved calendar draft and its dirty warning", async () => {
    const { forms, gmailForm, senders, windowListeners } =
      await loadAdministrationDocument("administrator");
    forms[1].householdLabel.value = "Papa draft";
    await forms[1].emit("input", forms[1].householdLabel);
    const gmailDraft = senders.children[0].querySelector("input");
    expect(gmailDraft).not.toBeNull();
    gmailDraft!.value = "new.example.org";
    await gmailForm.emit("input", gmailDraft!);

    await gmailForm.emit("submit");

    expect(forms[1].householdLabel.value).toBe("Papa draft");
    const preventDefault = vi.fn();
    windowListeners.get("beforeunload")?.({
      currentTarget: new FakeElement(),
      target: new FakeElement(),
      preventDefault
    });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  test("saving Weather preserves an unsaved Gmail draft and its dirty warning", async () => {
    const { gmailForm, senders, weatherForm, windowListeners } =
      await loadAdministrationDocument("administrator");
    const gmailDraft = senders.children[0].querySelector("input");
    expect(gmailDraft).not.toBeNull();
    gmailDraft!.value = "draft.example.org";
    await gmailForm.emit("input", gmailDraft!);
    weatherForm.latitude.value = "40";
    await weatherForm.emit("input", weatherForm.latitude);

    await weatherForm.emit("submit");

    expect(senders.children[0].querySelector("input")?.value).toBe(
      "draft.example.org"
    );
    const preventDefault = vi.fn();
    windowListeners.get("beforeunload")?.({
      currentTarget: new FakeElement(),
      target: new FakeElement(),
      preventDefault
    });
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  test("Selected Calendars are labeled Unavailable only after successful discovery", async () => {
    const reviewer = await loadAdministrationDocument("reviewer");
    const reviewerCalendar = reviewer.forms[0]
      .querySelector("[data-calendars]")
      ?.children[0];
    expect(reviewerCalendar?.querySelector("span")?.textContent).toBe("Family");

    const failed = await loadAdministrationDocument("administrator", {
      discovery: new Response(null, { status: 502 })
    });
    await failed.refreshButtons[0].emit("click");
    const failedCalendar = failed.forms[0]
      .querySelector("[data-calendars]")
      ?.children[0];
    expect(failedCalendar?.querySelector("span")?.textContent).toBe("Family");

    const succeeded = await loadAdministrationDocument("administrator");
    await succeeded.refreshButtons[0].emit("click");
    const unavailableCalendar = succeeded.forms[0]
      .querySelector("[data-calendars]")
      ?.children[0];
    expect(unavailableCalendar?.querySelector("span")?.textContent).toBe(
      "Family — Unavailable"
    );
  });

  test("filtering Discovered Calendars preserves hidden selections and label drafts on save", async () => {
    const page = await loadAdministrationDocument("administrator", {
      discovery: Response.json({
        calendars: [
          { id: "school", label: "School" },
          { id: "work", label: "Work" }
        ]
      })
    });
    const form = page.forms[0];
    await page.refreshButtons[0].emit("click");
    const calendarBox = form.querySelector("[data-calendars]");
    const schoolRow = calendarBox?.children.find(
      (row) => row.querySelector('[name="calendar"]')?.value === "school"
    );
    const schoolCheckbox = schoolRow?.querySelector('[name="calendar"]');
    const schoolLabel = schoolRow?.querySelector('[name="calendarLabel"]');
    expect(schoolCheckbox).not.toBeNull();
    expect(schoolLabel).not.toBeNull();
    schoolCheckbox!.checked = true;
    await schoolCheckbox!.emit("input");
    schoolLabel!.value = "School pickup";
    await schoolLabel!.emit("input");

    form.filter.value = "Work";
    await form.filter.emit("input");
    expect(calendarBox?.children).toHaveLength(1);
    expect(calendarBox?.children[0].querySelector("span")?.textContent).toBe(
      "Work"
    );

    await form.emit("submit");

    const save = [...page.requests]
      .reverse()
      .find(
        ({ url, init }) =>
          url === "/admin/calendar-configuration" && init?.method === "PUT"
      );
    expect(JSON.parse(String(save?.init?.body))).toEqual({
      accounts: [
        {
          accountId: "mom",
          displayLabel: "Mom",
          calendars: [
            { id: "family", label: "Family" },
            { id: "school", label: "School pickup" }
          ]
        },
        {
          accountId: "dad",
          displayLabel: "Dad",
          calendars: []
        }
      ]
    });
  });

  test("anonymous and device-token requests are denied on the admin hostname", async () => {
    const environment = env();
    const anonymous = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status"),
      environment
    );
    const deviceToken = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status", {
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": "device-token"
        }
      }),
      environment
    );

    expect(anonymous.status).toBe(401);
    expect(deviceToken.status).toBe(401);
  });

  test("reviewers can read safe configuration and status but cannot mutate", async () => {
    const environment = env();
    const headers = accessHeaders("reviewer@example.com");
    const configuration = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        headers
      }),
      environment
    );
    const status = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status", {
        headers
      }),
      environment
    );
    const calendarConfiguration = await worker.fetch(
      new Request(
        "https://dashboard-admin.example.com/admin/calendar-configuration",
        { headers }
      ),
      environment
    );
    const weatherConfiguration = await worker.fetch(
      new Request(
        "https://dashboard-admin.example.com/admin/weather-configuration",
        { headers }
      ),
      environment
    );
    const gmailConfiguration = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/gmail-configuration", {
        headers
      }),
      environment
    );
    const mutation = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          weather: {
            latitude: 37.7749,
            longitude: -122.4194,
            slots: ["06:30", "10:30", "15:00", "19:00"]
          }
        })
      }),
      environment
    );

    expect(configuration.status).toBe(200);
    const configurationBody = await configuration.json();
    expect(configurationBody).toEqual({
      weather: {
        latitude: 37.3382,
        longitude: -121.8863,
        timezone: "America/Los_Angeles",
        slots: ["06:30", "10:30", "15:00", "19:00"]
      },
      google: {
        accounts: [
          {
            accountId: "dad",
            displayLabel: "Dad",
            connected: true,
            calendars: []
          },
          {
            accountId: "mom",
            displayLabel: "Mom",
            connected: false,
            reconnectRequired: true,
            calendars: [{ id: "family", label: "Family" }]
          }
        ]
      }
    });

    expect(status.status).toBe(200);
    expect(weatherConfiguration.status).toBe(200);
    expect(calendarConfiguration.status).toBe(200);
    expect(gmailConfiguration.status).toBe(200);
    const statusBody = await status.json();
    expect(statusBody).toEqual({
      device: { lastCheckInAt: "2026-10-07T16:00:00.000Z" },
      rendering: {
        currentGenerationId: "generation-20261007T150000Z",
        lastSuccessfulAt: "2026-10-07T15:00:00.000Z",
        latestAttempt: {
          slotKey: "2026-10-07T19:00",
          state: "failed",
          attempt: 1,
          retryAt: "2026-10-07T19:15:00.000Z",
          errorCode: "DAILY_BRIEF_RENDER_FAILED"
        }
      },
      sources: [
        {
          source: "weather",
          state: "fresh",
          lastSuccessfulAt: "2026-10-07T15:00:00.000Z",
          errorCode: null
        },
        {
          source: "calendar",
          state: "error",
          lastSuccessfulAt: "2026-10-07T10:30:00.000Z",
          errorCode: "CALENDAR_OAUTH_REVOKED"
        }
      ],
      oauth: [
        { accountId: "dad", state: "connected" },
        { accountId: "mom", state: "revoked" }
      ],
      aiQuota: "available",
      incidents: [
        {
          errorCode: "CALENDAR_OAUTH_REVOKED",
          occurredAt: "2026-10-07T16:30:00.000Z",
          notifiedAt: "2026-10-07T16:30:05.000Z"
        }
      ]
    });
    expect(JSON.stringify({ configurationBody, statusBody })).not.toMatch(
      /refresh.token|payload|content|message/i
    );
    expect(mutation.status).toBe(403);
  });

  test("status exposes canonical Notices and Gmail codes but drops arbitrary content", async () => {
    const database = new AdminDatabase();
    database.generationErrorCode = "NOTICES_VIEW_RENDER_FAILED";
    database.sourceErrorCode = "GMAIL_PROCESSING_FAILED";
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status", {
        headers: accessHeaders("reviewer@example.com")
      }),
      env(database)
    );

    const body = await response.json<{
      rendering: { latestAttempt: { errorCode: string } };
      sources: Array<{ errorCode: string | null }>;
    }>();
    expect(body.rendering.latestAttempt.errorCode).toBe(
      "NOTICES_VIEW_RENDER_FAILED"
    );
    expect(body.sources[1].errorCode).toBe("GMAIL_PROCESSING_FAILED");

    database.generationErrorCode = "subject: private school message";
    const hidden = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/status", {
        headers: accessHeaders("reviewer@example.com")
      }),
      env(database)
    );
    expect(
      (
        await hidden.json<{
          rendering: { latestAttempt: { errorCode: string | null } };
        }>()
      ).rendering.latestAttempt.errorCode
    ).toBeNull();
  });

  test("both roles can inspect minimal protected Gmail records without raw content", async () => {
    for (const email of ["reviewer@example.com", "admin@example.com"]) {
      const response = await worker.fetch(
        new Request("https://dashboard-admin.example.com/admin/gmail-review", {
          headers: accessHeaders(email)
        }),
        env()
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        records: [
          {
            id: 7,
            accountId: "mom",
            kind: "sensitive",
            category: "school",
            summary: "Private appointment is scheduled.",
            relevantDate: "2026-10-13",
            action: null,
            senderOrganization: "School",
            confidence: 0.97,
            createdAt: "2026-10-07T17:00:00.000Z",
            expiresAt: "2026-10-21T17:00:00.000Z"
          }
        ]
      });
      expect(JSON.stringify(body)).not.toMatch(
        /source.key|model|message|thread|subject|body|sender.address|prompt/i
      );
    }
  });

  test("reviewers cannot dismiss, correct, or publish protected records", async () => {
    for (const action of ["dismiss", "correct", "publish"]) {
      const response = await worker.fetch(
        new Request("https://dashboard-admin.example.com/admin/gmail-review/7", {
          method: "POST",
          headers: {
            ...accessHeaders("reviewer@example.com"),
            "content-type": "application/json"
          },
          body: JSON.stringify({ action })
        }),
        env()
      );
      expect(response.status).toBe(403);
    }
  });

  test("administrator can correct and publish a protected record", async () => {
    const database = new AdminDatabase();
    const environment = env(database);
    const headers = {
      ...accessHeaders("admin@example.com"),
      "content-type": "application/json"
    };
    const correction = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/gmail-review/7", {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "correct",
          correction: {
            category: "activity",
            summary: "Appointment is scheduled.",
            relevantDate: "2026-10-13",
            action: "Check the protected source.",
            senderOrganization: "School"
          }
        })
      }),
      environment
    );
    const publication = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/gmail-review/7", {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "publish" })
      }),
      environment
    );

    expect(correction.status).toBe(200);
    expect(publication.status).toBe(200);
    expect(database.publishedNotices).toEqual([
      expect.objectContaining({
        accountId: "mom",
        category: "activity",
        summary: "Appointment is scheduled.",
        action: "Check the protected source."
      })
    ]);
    const html = noticesViewHtml({
      notices: database.publishedNotices as unknown as DailyBriefNotice[],
      privateNoticeMarkers: [],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T18:00:00.000Z"
    });
    expect(html).toContain("Appointment is scheduled.");
    expect(html).toContain("School");
    expect(html).not.toContain("Private appointment is scheduled.");
    expect(database.protectedReviews).toEqual([]);
  });

  test("administrator can dismiss a protected record", async () => {
    const database = new AdminDatabase();
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/gmail-review/7", {
        method: "POST",
        headers: {
          ...accessHeaders("admin@example.com"),
          "content-type": "application/json"
        },
        body: JSON.stringify({ action: "dismiss" })
      }),
      env(database)
    );

    expect(response.status).toBe(200);
    expect(database.protectedReviews).toEqual([]);
  });

  test("administrator disconnect revokes Google and removes retained account data and images", async () => {
    const database = new AdminDatabase();
    const encryptionKey = btoa("0123456789abcdef0123456789abcdef");
    database.encryptedRefreshTokens.set(
      "mom",
      await encryptRefreshToken("refresh-token", encryptionKey)
    );
    const imageKeys = ["generations/one.png", "generations/two.png"];
    const imageBucket = {
      list: vi.fn().mockResolvedValue({
        objects: imageKeys.map((key) => ({ key })),
        truncated: false
      }),
      delete: vi.fn().mockResolvedValue(undefined)
    };
    const revoke = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    const response = await worker.fetch(
      new Request(
        "https://dashboard-admin.example.com/admin/gmail-accounts/mom/disconnect",
        {
          method: "POST",
          headers: accessHeaders("admin@example.com")
        }
      ),
      env(database, {
        CALENDAR_TOKEN_ENCRYPTION_KEY: encryptionKey,
        IMAGES: imageBucket as unknown as R2Bucket
      })
    );

    expect(response.status).toBe(200);
    expect(revoke).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({
        method: "POST",
        body: "token=refresh-token"
      })
    );
    expect(imageBucket.delete).toHaveBeenCalledWith(imageKeys);
    expect(database.deletedAccountArtifacts.sort()).toEqual(
      [
        "calendar_account_credentials",
        "calendar_snapshots",
        "gmail_protected_reviews",
        "gmail_review_records",
        "household_notices",
        "render_generations",
        "selected_calendars"
      ].sort()
    );
    revoke.mockRestore();
  });

  test("OAuth callback redirects ordinary browsers with a fixed account status and preserves explicit JSON compatibility", async () => {
    const database = new AdminDatabase();
    const encryptionKey = btoa("0123456789abcdef0123456789abcdef");
    const environment = env(database, {
      GOOGLE_CLIENT_ID: "client-id",
      GOOGLE_CLIENT_SECRET: "client-secret",
      CALENDAR_TOKEN_ENCRYPTION_KEY: encryptionKey
    });
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({
        refresh_token: "provider-refresh-token",
        access_token: "provider-access-token",
        expires_in: 3600
      })
    );
    const stateFor = async (account: "mom" | "dad") => {
      const start = await worker.fetch(
        new Request(
          `https://dashboard-admin.example.com/admin/calendar/oauth/start?account=${account}`,
          { headers: accessHeaders("admin@example.com") }
        ),
        environment
      );
      return new URL(
        (await start.json<{ authorizationUrl: string }>()).authorizationUrl
      ).searchParams.get("state")!;
    };

    const browser = await worker.fetch(
      new Request(
        `https://dashboard-admin.example.com/admin/calendar/oauth/callback?code=secret-provider-code&state=${encodeURIComponent(await stateFor("mom"))}`,
        { headers: accessHeaders("admin@example.com"), redirect: "manual" }
      ),
      environment
    );
    expect(browser.status).toBe(302);
    expect(browser.headers.get("location")).toBe("/admin?calendar=mom-connected");
    expect(browser.headers.get("location")).not.toContain("secret-provider-code");

    const api = await worker.fetch(
      new Request(
        `https://dashboard-admin.example.com/admin/calendar/oauth/callback?code=another-secret-code&state=${encodeURIComponent(await stateFor("dad"))}`,
        {
          headers: {
            ...accessHeaders("admin@example.com"),
            accept: "application/json"
          }
        }
      ),
      environment
    );
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ accountId: "dad", connected: true });
    upstream.mockRestore();
  });

  test("disconnect reports and resumes pending cleanup after an R2 failure", async () => {
    const database = new AdminDatabase();
    const encryptionKey = btoa("0123456789abcdef0123456789abcdef");
    database.encryptedRefreshTokens.set(
      "mom",
      await encryptRefreshToken("refresh-token", encryptionKey)
    );
    const imageBucket = {
      list: vi
        .fn()
        .mockRejectedValueOnce(new Error("R2 unavailable"))
        .mockResolvedValueOnce({ objects: [], truncated: false }),
      delete: vi.fn().mockResolvedValue(undefined)
    };
    const revoke = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const environment = env(database, {
      CALENDAR_TOKEN_ENCRYPTION_KEY: encryptionKey,
      IMAGES: imageBucket as unknown as R2Bucket
    });
    const request = () =>
      new Request(
        "https://dashboard-admin.example.com/admin/gmail-accounts/mom/disconnect",
        { method: "POST", headers: accessHeaders("admin@example.com") }
      );

    const first = await worker.fetch(request(), environment);
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({
      accountId: "mom",
      disconnected: true,
      cleanupPending: true,
      errorCode: "GOOGLE_ACCOUNT_CLEANUP_PENDING"
    });
    expect(database.encryptedRefreshTokens.has("mom")).toBe(false);
    expect(database.deletedAccountArtifacts).toContain("household_notices");

    const retry = await worker.fetch(request(), environment);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({
      accountId: "mom",
      disconnected: true
    });
    expect(revoke).toHaveBeenCalledOnce();
    expect(database.disconnectStates.has("mom")).toBe(false);
    revoke.mockRestore();
  });

  test("disconnect retries idempotently after a D1 cleanup failure", async () => {
    const database = new AdminDatabase();
    database.failCleanupBatchOnce = true;
    const encryptionKey = btoa("0123456789abcdef0123456789abcdef");
    database.encryptedRefreshTokens.set(
      "dad",
      await encryptRefreshToken("refresh-token", encryptionKey)
    );
    const imageBucket = {
      list: vi.fn().mockResolvedValue({ objects: [], truncated: false }),
      delete: vi.fn().mockResolvedValue(undefined)
    };
    const revoke = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const environment = env(database, {
      CALENDAR_TOKEN_ENCRYPTION_KEY: encryptionKey,
      IMAGES: imageBucket as unknown as R2Bucket
    });
    const request = () =>
      new Request(
        "https://dashboard-admin.example.com/admin/gmail-accounts/dad/disconnect",
        { method: "POST", headers: accessHeaders("admin@example.com") }
      );

    expect((await worker.fetch(request(), environment)).status).toBe(202);
    expect((await worker.fetch(request(), environment)).status).toBe(200);
    expect(revoke).toHaveBeenCalledOnce();
    expect(imageBucket.list).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });

  test("administrators can update weather, slots, calendars, and household labels", async () => {
    const database = new AdminDatabase();
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        method: "PUT",
        headers: {
          ...accessHeaders("admin@example.com"),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          weather: {
            latitude: 37.7749,
            longitude: -122.4194,
            slots: ["19:00", "06:30", "15:00", "10:30"]
          },
          google: {
            accounts: [
              {
                accountId: "mom",
                displayLabel: "Mama",
                calendars: [{ id: "family", label: "Family" }]
              },
              {
                accountId: "dad",
                displayLabel: "Papa",
                calendars: []
              }
            ]
          }
        })
      }),
      env(database)
    );

    expect(response.status).toBe(200);
    expect(database.configuration).toEqual({
      latitude: 37.7749,
      longitude: -122.4194,
      timezone: "America/Los_Angeles",
      slotsJson: '["06:30","10:30","15:00","19:00"]'
    });
  });

  test("calendar configuration normalizes safe labels and enforces label and selection limits", async () => {
    const database = new AdminDatabase();
    const request = (accounts: unknown) =>
      worker.fetch(
        new Request(
          "https://dashboard-admin.example.com/admin/calendar-configuration",
          {
            method: "PUT",
            headers: {
              ...accessHeaders("admin@example.com"),
              "content-type": "application/json"
            },
            body: JSON.stringify({ accounts })
          }
        ),
        env(database)
      );

    const saved = await request([
      {
        accountId: "mom",
        displayLabel: "  Mère   &   Dad  ",
        calendars: [{ id: "family", label: "  École   -   Main  " }]
      },
      { accountId: "dad", displayLabel: "Papa", calendars: [] }
    ]);
    expect(saved.status).toBe(200);
    expect(database.accountLabels.get("mom")).toBe("Mère & Dad");
    expect(database.selectedCalendars).toContainEqual({
      account_id: "mom",
      calendar_id: "family",
      display_label: "École - Main"
    });

    for (const invalid of [
      {
        displayLabel: "Mom\tHouse",
        calendarLabel: "Family"
      },
      {
        displayLabel: "Mom",
        calendarLabel: "Family\nCalendar"
      }
    ]) {
      expect(
        (
          await request([
            {
              accountId: "mom",
              displayLabel: invalid.displayLabel,
              calendars: [
                { id: "family", label: invalid.calendarLabel }
              ]
            },
            { accountId: "dad", displayLabel: "Dad", calendars: [] }
          ])
        ).status
      ).toBe(400);
    }

    for (const displayLabel of [
      "Family 👨‍👩‍👧",
      "person@example.com",
      "https://example.com"
    ]) {
      expect(
        (
          await request([
            { accountId: "mom", displayLabel, calendars: [] },
            { accountId: "dad", displayLabel: "Dad", calendars: [] }
          ])
        ).status
      ).toBe(400);
    }
    expect(
      (
        await request([
          {
            accountId: "mom",
            displayLabel: "Mom",
            calendars: Array.from({ length: 11 }, (_, index) => ({
              id: `calendar-${index}`,
              label: `Calendar ${index}`
            }))
          },
          { accountId: "dad", displayLabel: "Dad", calendars: [] }
        ])
      ).status
    ).toBe(400);
  });

  test("saving newly Selected Calendars requires fresh server discovery and retains configuration on failure", async () => {
    const database = new AdminDatabase();
    const encryptionKey = btoa("0123456789abcdef0123456789abcdef");
    database.encryptedRefreshTokens.set(
      "mom",
      await encryptRefreshToken("refresh-token", encryptionKey)
    );
    const upstream = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "access-token" });
      }
      if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        return Response.json({
          items: [{ id: "school", summary: "School" }]
        });
      }
      throw new Error("Unexpected upstream request");
    });
    const save = (calendarId: string) =>
      worker.fetch(
        new Request(
          "https://dashboard-admin.example.com/admin/calendar-configuration",
          {
            method: "PUT",
            headers: {
              ...accessHeaders("admin@example.com"),
              "content-type": "application/json"
            },
            body: JSON.stringify({
              accounts: [
                {
                  accountId: "mom",
                  displayLabel: "Mom",
                  calendars: [
                    { id: "family", label: "Family" },
                    { id: calendarId, label: "School" }
                  ]
                },
                { accountId: "dad", displayLabel: "Dad", calendars: [] }
              ]
            })
          }
        ),
        env(database, {
          GOOGLE_CLIENT_ID: "client-id",
          GOOGLE_CLIENT_SECRET: "client-secret",
          CALENDAR_TOKEN_ENCRYPTION_KEY: encryptionKey
        })
      );

    expect((await save("school")).status).toBe(200);
    expect(database.selectedCalendars).toContainEqual({
      account_id: "mom",
      calendar_id: "school",
      display_label: "School"
    });
    const retained = [...database.selectedCalendars];
    expect((await save("not-discovered")).status).toBe(400);
    expect(database.selectedCalendars).toEqual(retained);
    upstream.mockRestore();
  });

  test("Gmail configuration is a normalized strict domain-only full replacement", async () => {
    const database = new AdminDatabase();
    const save = (senders: unknown) =>
      worker.fetch(
        new Request(
          "https://dashboard-admin.example.com/admin/gmail-configuration",
          {
            method: "PUT",
            headers: {
              ...accessHeaders("admin@example.com"),
              "content-type": "application/json"
            },
            body: JSON.stringify({ senders })
          }
        ),
        env(database)
      );

    expect(
      (
        await save([
          { domain: " School.Example.ORG ", kind: "school" },
          { domain: "care.example.org", kind: "childcare" }
        ])
      ).status
    ).toBe(200);
    expect(database.gmailSenders).toEqual([
      { domain: "school.example.org", kind: "school" },
      { domain: "care.example.org", kind: "childcare" }
    ]);

    const retained = [...database.gmailSenders];
    for (const senders of [
      [
        { domain: "school.example.org", kind: "school" },
        { domain: "SCHOOL.EXAMPLE.ORG", kind: "childcare" }
      ],
      [{ domain: "*.example.org", kind: "school" }],
      [{ domain: ".example.org", kind: "school" }],
      [{ domain: "example..org", kind: "school" }],
      [{ domain: "bad_label.example.org", kind: "school" }],
      [{ domain: "example.org.", kind: "school" }]
    ]) {
      expect((await save(senders)).status).toBe(400);
      expect(database.gmailSenders).toEqual(retained);
    }
    expect((await save([])).status).toBe(200);
    expect(database.gmailSenders).toEqual([]);
    expect(
      (
        await save(
          Array.from({ length: 51 }, (_, index) => ({
            domain: `school-${index}.example.org`,
            kind: "school"
          }))
        )
      ).status
    ).toBe(400);
  });

  test("administration rejects JSON bodies over 64 KiB before mutation", async () => {
    const database = new AdminDatabase();
    const response = await worker.fetch(
      new Request("https://dashboard-admin.example.com/admin/configuration", {
        method: "PUT",
        headers: {
          ...accessHeaders("admin@example.com"),
          "content-type": "application/json"
        },
        body: JSON.stringify({ padding: "x".repeat(65_536) })
      }),
      env(database)
    );

    expect(response.status).toBe(413);
    expect(database.configuration.latitude).toBe(37.3382);
  });

  test("section configuration routes reject malformed JSON with fixed safe responses", async () => {
    for (const path of [
      "weather-configuration",
      "calendar-configuration",
      "gmail-configuration"
    ]) {
      const response = await worker.fetch(
        new Request(`https://dashboard-admin.example.com/admin/${path}`, {
          method: "PUT",
          headers: {
            ...accessHeaders("admin@example.com"),
            "content-type": "application/json"
          },
          body: "{not-json"
        }),
        env()
      );
      expect(response.status).toBe(400);
      expect(JSON.stringify(await response.json())).not.toMatch(
        /syntax|position|not-json/i
      );
    }
  });

  test("admin routes are unavailable from the device hostname", async () => {
    const response = await worker.fetch(
      new Request("https://dashboard-device.example.com/admin/status", {
        headers: accessHeaders("admin@example.com")
      }),
      env()
    );

    expect(response.status).toBe(404);
  });
});

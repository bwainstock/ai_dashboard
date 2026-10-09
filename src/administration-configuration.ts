export type HouseholdAccountId = "mom" | "dad";

export interface CalendarConfigurationAccount {
  accountId: HouseholdAccountId;
  displayLabel: string;
  calendars: Array<{ id: string; label: string }>;
}

export interface GmailSenderDomain {
  domain: string;
  kind: "school" | "childcare";
}

export interface WeatherConfigurationInput {
  latitude: number;
  longitude: number;
  slots: string[];
}

export type CalendarSelectionValidationFailure =
  | "disconnected"
  | "discovery_failed"
  | "not_discovered";

export function calendarSelectionValidationError(
  failure: CalendarSelectionValidationFailure | null
): { error: string; status: number } | null {
  switch (failure) {
    case "disconnected":
      return { error: "Calendar account is disconnected", status: 409 };
    case "not_discovered":
      return { error: "Selected Calendar was not discovered", status: 400 };
    case "discovery_failed":
      return { error: "Calendar discovery failed", status: 502 };
    default:
      return null;
  }
}

export function normalizeWeatherConfiguration(
  value: unknown
): WeatherConfigurationInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as {
    latitude?: unknown;
    longitude?: unknown;
    slots?: unknown;
  };
  if (
    typeof input.latitude !== "number" ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    typeof input.longitude !== "number" ||
    input.longitude < -180 ||
    input.longitude > 180 ||
    !Array.isArray(input.slots) ||
    input.slots.length < 1 ||
    new Set(input.slots).size !== input.slots.length ||
    input.slots.some(
      (slot) =>
        typeof slot !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)
    )
  ) {
    return null;
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    slots: [...input.slots].sort() as string[]
  };
}

function normalizedLabel(
  value: unknown,
  maximumLength: number
): string | null {
  if (typeof value !== "string") return null;
  if (/\p{Cc}/u.test(value)) return null;
  const normalized = value.trim().replaceAll(/\s+/gu, " ");
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    !/^[\p{L}\p{N} &'’.-]+$/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function normalizeCalendarConfiguration(
  value: unknown
): CalendarConfigurationAccount[] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const accounts: CalendarConfigurationAccount[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const account = candidate as {
      accountId?: unknown;
      displayLabel?: unknown;
      calendars?: unknown;
    };
    if (account.accountId !== "mom" && account.accountId !== "dad") return null;
    const displayLabel = normalizedLabel(account.displayLabel, 20);
    if (
      !displayLabel ||
      !Array.isArray(account.calendars) ||
      account.calendars.length > 10
    ) {
      return null;
    }
    const calendars: Array<{ id: string; label: string }> = [];
    const ids = new Set<string>();
    for (const candidateCalendar of account.calendars) {
      if (!candidateCalendar || typeof candidateCalendar !== "object") {
        return null;
      }
      const calendar = candidateCalendar as { id?: unknown; label?: unknown };
      const label = normalizedLabel(calendar.label, 40);
      if (
        typeof calendar.id !== "string" ||
        calendar.id.length < 1 ||
        calendar.id.length > 1024 ||
        ids.has(calendar.id) ||
        !label
      ) {
        return null;
      }
      ids.add(calendar.id);
      calendars.push({ id: calendar.id, label });
    }
    accounts.push({ accountId: account.accountId, displayLabel, calendars });
  }
  return new Set(accounts.map(({ accountId }) => accountId)).size === 2
    ? accounts
    : null;
}

function normalizedDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const domain = value.trim().toLowerCase();
  if (domain.length < 1 || domain.length > 253 || !domain.includes(".")) {
    return null;
  }
  const labels = domain.split(".");
  if (
    labels.some(
      (label) =>
        label.length < 1 ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )
  ) {
    return null;
  }
  return domain;
}

export function normalizeGmailSenderDomains(
  value: unknown
): GmailSenderDomain[] | null {
  if (!Array.isArray(value) || value.length > 50) return null;
  const senders: GmailSenderDomain[] = [];
  const domains = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") return null;
    const sender = candidate as { domain?: unknown; kind?: unknown };
    const domain = normalizedDomain(sender.domain);
    if (
      !domain ||
      domains.has(domain) ||
      (sender.kind !== "school" && sender.kind !== "childcare")
    ) {
      return null;
    }
    domains.add(domain);
    senders.push({ domain, kind: sender.kind });
  }
  return senders;
}

export async function replaceWeatherConfiguration(
  db: D1Database,
  value: unknown
): Promise<WeatherConfigurationInput | null> {
  const input = normalizeWeatherConfiguration(value);
  if (!input) return null;
  await db
    .prepare(
      `UPDATE dashboard_configuration
       SET latitude = ?, longitude = ?, slots_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    )
    .bind(input.latitude, input.longitude, JSON.stringify(input.slots))
    .run();
  return input;
}

export async function replaceCalendarConfiguration(
  db: D1Database,
  value: unknown
): Promise<CalendarConfigurationAccount[] | null> {
  const accounts = normalizeCalendarConfiguration(value);
  if (!accounts) return null;
  await db.batch(
    accounts.flatMap((account) => [
      db
        .prepare(
          `UPDATE calendar_accounts
           SET display_label = ?, updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ?`
        )
        .bind(account.displayLabel, account.accountId),
      db
        .prepare("DELETE FROM selected_calendars WHERE account_id = ?")
        .bind(account.accountId),
      ...account.calendars.map((calendar) =>
        db
          .prepare(
            `INSERT INTO selected_calendars
               (account_id, calendar_id, display_label)
             VALUES (?, ?, ?)`
          )
          .bind(account.accountId, calendar.id, calendar.label)
      )
    ])
  );
  return accounts;
}

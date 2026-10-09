import { describe, expect, test, vi } from "vitest";
import {
  runScheduledWeatherGeneration,
  secondsUntilNextSlot,
  type ScheduledGenerationPorts
} from "../src/generation";
import type { WeatherSnapshot } from "../src/weather";
import type { LunchSnapshot } from "../src/lunch";
import type { CalendarEvent } from "../src/calendar";

const WEATHER: WeatherSnapshot = {
  observedAt: "2026-10-07T10:25",
  current: { temperature: 68, condition: "Mostly clear" },
  today: {
    date: "2026-10-07",
    condition: "Partly cloudy",
    high: 75,
    low: 55,
    precipitationProbability: 10
  },
  tomorrow: {
    date: "2026-10-08",
    condition: "Rain",
    high: 64,
    low: 51,
    precipitationProbability: 70
  }
};

const LUNCH: LunchSnapshot = {
  days: [
    {
      date: "2026-10-07",
      status: "menu",
      entrees: ["Cheese Pizza", "Vegetable Yakisoba"]
    }
  ]
};

function png(width = 800, height = 480): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function ports(
  overrides: Partial<ScheduledGenerationPorts> = {}
): ScheduledGenerationPorts {
  return {
    claimSlot: vi.fn().mockResolvedValue(true),
    claimRetry: vi.fn().mockResolvedValue(null),
    fetchWeather: vi.fn().mockResolvedValue(WEATHER),
    loadLatestWeather: vi.fn().mockResolvedValue(null),
    saveWeather: vi.fn().mockResolvedValue(undefined),
    fetchLunch: vi.fn().mockResolvedValue(LUNCH),
    loadLatestLunch: vi.fn().mockResolvedValue(null),
    saveLunch: vi.fn().mockResolvedValue(undefined),
    loadCachedLunchIcon: vi.fn().mockResolvedValue(null),
    saveCachedLunchIcon: vi.fn().mockResolvedValue(undefined),
    classifyLunchWithAi: vi.fn().mockResolvedValue("pasta"),
    renderDailyBrief: vi.fn().mockResolvedValue(png()),
    renderCalendarView: vi.fn().mockResolvedValue(png()),
    renderLunchView: vi.fn().mockResolvedValue(png()),
    renderNoticesView: vi.fn().mockResolvedValue(png()),
    publish: vi.fn().mockResolvedValue(undefined),
    recordSourceFailure: vi.fn().mockResolvedValue(undefined),
    failGeneration: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as ScheduledGenerationPorts;
}

describe("scheduled weather generation", () => {
  test("a due local slot normalizes, renders, validates, and publishes an immutable Daily Brief", async () => {
    const prepareGeneration = vi.fn().mockResolvedValue(undefined);
    const boundary = ports({ prepareGeneration });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result).toEqual({
      status: "published",
      slotKey: "2026-10-07T10:30[America/Los_Angeles]",
      filename: "daily-brief-20261007T173000Z.png",
      nextWakeSeconds: 16_200
    });
    expect(prepareGeneration).toHaveBeenCalledOnce();
    expect(boundary.renderDailyBrief).toHaveBeenCalledWith({
      weather: WEATHER,
      stale: false,
      lunch: {
        status: "available",
        stale: false,
        entrees: [
          { name: "Cheese Pizza", icon: "pizza" },
          { name: "Vegetable Yakisoba", icon: "pasta" }
        ]
      },
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(boundary.renderCalendarView).toHaveBeenCalledWith({
      calendar: [],
      timezone: "America/Los_Angeles",
      stale: false,
      updatedAt: "2026-10-07T17:30:00.000Z"
    });
    expect(boundary.renderLunchView).toHaveBeenCalledWith(
      expect.objectContaining({
        week: "current",
        days: expect.arrayContaining([
          expect.objectContaining({
            date: "2026-10-07",
            entrees: [
              { name: "Cheese Pizza", icon: "pizza" },
              { name: "Vegetable Yakisoba", icon: "pasta" }
            ]
          })
        ])
      })
    );
    expect(boundary.publish).toHaveBeenCalledWith({
      generationId: "20261007T173000Z",
      slotKey: "2026-10-07T10:30[America/Los_Angeles]",
      views: [
        {
          viewType: "daily_brief",
          filename: "daily-brief-20261007T173000Z.png",
          objectKey: "generations/20261007T173000Z/daily-brief.png",
          image: expect.any(Uint8Array)
        },
        {
          viewType: "calendar",
          filename: "calendar-view-20261007T173000Z.png",
          objectKey: "generations/20261007T173000Z/calendar-view.png",
          image: expect.any(Uint8Array)
        },
        {
          viewType: "lunch",
          filename: "lunch-view-20261007T173000Z.png",
          objectKey: "generations/20261007T173000Z/lunch-view.png",
          image: expect.any(Uint8Array)
        },
        {
          viewType: "notices",
          filename: "notices-view-20261007T173000Z.png",
          objectKey: "generations/20261007T173000Z/notices-view.png",
          image: expect.any(Uint8Array)
        }
      ],
      width: 800,
      height: 480,
      weather: WEATHER,
      lunch: LUNCH,
      generatedAt: "2026-10-07T17:30:00.000Z"
    });
  });

  test("a non-due cron invocation does not prepare Gmail processing", async () => {
    const prepareGeneration = vi.fn().mockResolvedValue(undefined);
    const boundary = ports({ prepareGeneration });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:31:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result.status).toBe("not_due");
    expect(prepareGeneration).not.toHaveBeenCalled();
  });

  test("renders at most eight active notices and Private Notice Markers into Notices View", async () => {
    const notices = Array.from({ length: 10 }, (_, index) => ({
      category: "school" as const,
      summary: `Notice ${index + 1}`,
      relevantDate: "2026-10-10",
      action: null,
      senderOrganization: "School"
    }));
    const boundary = ports({
      loadNotices: vi.fn().mockResolvedValue(notices),
      loadPrivateNoticeMarkers: vi
        .fn()
        .mockResolvedValue([{ accountId: "mom" as const }])
    });

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(boundary.renderDailyBrief).toHaveBeenCalledWith(
      expect.objectContaining({ notices: notices.slice(0, 2) })
    );
    expect(boundary.renderNoticesView).toHaveBeenCalledWith({
      notices: notices.slice(0, 8),
      privateNoticeMarkers: [{ accountId: "mom" }],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });
  });

  test("a weekend generation requests the upcoming school week and labels an unavailable menu explicitly", async () => {
    const boundary = ports({
      fetchLunch: vi.fn().mockResolvedValue({ days: [] })
    });

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-10T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(boundary.renderLunchView).toHaveBeenCalledWith(
      expect.objectContaining({
        week: "upcoming",
        status: "upcoming_unavailable"
      })
    );
  });

  test("an explicit upstream failure publishes the last valid weather as stale", async () => {
    const failure = Object.assign(new Error("Open-Meteo returned HTTP 503"), {
      code: "WEATHER_UPSTREAM_HTTP"
    });

    const boundary = ports({
      fetchWeather: vi.fn().mockRejectedValue(failure),
      loadLatestWeather: vi.fn().mockResolvedValue({
        snapshot: WEATHER,
        fetchedAt: "2026-10-07T19:00:00.000Z"
      })
    });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T22:00:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result.status).toBe("published");
    expect(boundary.renderDailyBrief).toHaveBeenCalledWith({
      weather: WEATHER,
      stale: true,
      staleAgeMinutes: 180,
      lunch: {
        status: "available",
        stale: false,
        entrees: [
          { name: "Cheese Pizza", icon: "pizza" },
          { name: "Vegetable Yakisoba", icon: "pasta" }
        ]
      },
      updatedAt: "2026-10-07T22:00:00.000Z"
    });
    expect(boundary.recordSourceFailure).toHaveBeenCalledWith(
      "2026-10-07T15:00[America/Los_Angeles]",
      "weather",
      "WEATHER_UPSTREAM_HTTP",
      "Open-Meteo returned HTTP 503"
    );
  });

  test("calendar events are refreshed and supplied to the Daily Brief generation seam", async () => {
    const calendar: CalendarEvent[] = [
      {
        occurrenceId: "school|2026-10-07",
        title: "School holiday",
        start: "2026-10-07",
        end: "2026-10-08",
        allDay: true,
        tentative: false,
        private: false,
        ownerLabels: ["Mom", "Dad"]
      }
    ];
    const boundary = ports({
      fetchCalendar: vi.fn().mockResolvedValue(calendar),
      loadLatestCalendar: vi.fn().mockResolvedValue({
        snapshot: [],
        fetchedAt: "2026-10-07T16:30:00.000Z"
      }),
      saveCalendar: vi.fn().mockResolvedValue(undefined)
    });

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(boundary.saveCalendar).toHaveBeenCalledWith(
      calendar,
      "2026-10-07T17:30:00.000Z"
    );
    expect(boundary.renderDailyBrief).toHaveBeenCalledWith({
      weather: WEATHER,
      calendar,
      stale: false,
      lunch: {
        status: "available",
        stale: false,
        entrees: [
          { name: "Cheese Pizza", icon: "pizza" },
          { name: "Vegetable Yakisoba", icon: "pasta" }
        ]
      },
      updatedAt: "2026-10-07T17:30:00.000Z"
    });
  });

  test("an upstream failure without a last valid snapshot fails explicitly", async () => {
    const boundary = ports({
      fetchWeather: vi.fn().mockRejectedValue(
        Object.assign(new Error("Open-Meteo returned HTTP 503"), {
          code: "WEATHER_UPSTREAM_HTTP"
        })
      )
    });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-08T02:00:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result).toEqual({
      status: "failed",
      slotKey: "2026-10-07T19:00[America/Los_Angeles]",
      code: "WEATHER_UPSTREAM_HTTP",
      nextWakeSeconds: 41_400
    });
    expect(boundary.renderDailyBrief).not.toHaveBeenCalled();
    expect(boundary.publish).not.toHaveBeenCalled();
  });

  test.each([
    [
      "missing menus",
      { days: [] },
      { status: "no_menu", stale: false, entrees: [] }
    ],
    [
      "reliable explicit closures",
      {
        days: [{ date: "2026-10-07", status: "closed" as const, entrees: [] }]
      },
      { status: "closed", stale: false, entrees: [] }
    ]
  ])("renders %s as a distinct lunch state", async (_label, lunch, expected) => {
    const boundary = ports({ fetchLunch: vi.fn().mockResolvedValue(lunch) });

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(boundary.renderDailyBrief).toHaveBeenCalledWith(
      expect.objectContaining({ lunch: expected })
    );
  });

  test.each([
    ["LUNCH_INVALID_RESPONSE", "schema_failure"],
    ["LUNCH_UPSTREAM_HTTP", "adapter_failure"]
  ])(
    "a %s remains visibly distinct while retaining last normalized entrees",
    async (code, status) => {
      const boundary = ports({
        fetchLunch: vi
          .fn()
          .mockRejectedValue(Object.assign(new Error("lunch failed"), { code })),
        loadLatestLunch: vi.fn().mockResolvedValue({
          snapshot: LUNCH,
          fetchedAt: "2026-10-07T16:30:00.000Z"
        })
      });

      const result = await runScheduledWeatherGeneration(
        {
          now: new Date("2026-10-07T17:30:00Z"),
          configuration: {
            latitude: 37.3382,
            longitude: -121.8863,
            timezone: "America/Los_Angeles",
            slots: ["06:30", "10:30", "15:00", "19:00"]
          },
          maximumImageBytes: 1_000_000
        },
        boundary
      );

      expect(result.status).toBe("published");
      expect(boundary.renderDailyBrief).toHaveBeenCalledWith(
        expect.objectContaining({
          lunch: {
            status,
            stale: true,
            staleAgeMinutes: 60,
            entrees: [
              { name: "Cheese Pizza", icon: "pizza" },
              { name: "Vegetable Yakisoba", icon: "pasta" }
            ]
          }
        })
      );
      expect(boundary.recordSourceFailure).toHaveBeenCalledWith(
        "2026-10-07T10:30[America/Los_Angeles]",
        "lunch",
        code,
        "lunch failed"
      );
    }
  );

  test("duplicate delivery of a due slot does not fetch or publish again", async () => {
    const boundary = ports({
      claimSlot: vi.fn().mockResolvedValue(false)
    });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result.status).toBe("duplicate");
    expect(boundary.fetchWeather).not.toHaveBeenCalled();
    expect(boundary.publish).not.toHaveBeenCalled();
  });

  test("a render outside the device PNG contract does not advance publication", async () => {
    const boundary = ports({
      renderDailyBrief: vi.fn().mockResolvedValue(png(801, 480))
    });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result.status).toBe("failed");
    expect(boundary.publish).not.toHaveBeenCalled();
    expect(boundary.failGeneration).toHaveBeenCalledWith(
      "2026-10-07T10:30[America/Los_Angeles]",
      "RENDERED_IMAGE_INVALID",
      expect.any(String),
      "2026-10-07T17:45:00.000Z"
    );
  });

  test("a rendering failure preserves the previously published generation", async () => {
    const boundary = ports({
      renderDailyBrief: vi.fn().mockRejectedValue(new Error("browser timeout"))
    });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["06:30", "10:30", "15:00", "19:00"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "DAILY_BRIEF_RENDER_FAILED"
    });
    expect(boundary.publish).not.toHaveBeenCalled();
    expect(boundary.failGeneration).toHaveBeenCalledWith(
      "2026-10-07T10:30[America/Los_Angeles]",
      "DAILY_BRIEF_RENDER_FAILED",
      "browser timeout",
      "2026-10-07T17:45:00.000Z"
    );
  });

  test("a storage or atomic publication failure preserves the current generation and schedules one retry", async () => {
    const boundary = ports({
      publish: vi.fn().mockRejectedValue(new Error("R2 write failed"))
    });

    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(result).toMatchObject({
      status: "failed",
      code: "GENERATION_PUBLICATION_FAILED"
    });
    expect(boundary.failGeneration).toHaveBeenCalledWith(
      "2026-10-07T10:30[America/Los_Angeles]",
      "GENERATION_PUBLICATION_FAILED",
      "R2 write failed",
      "2026-10-07T17:45:00.000Z"
    );
  });

  test("a failed generation is retried once after fifteen minutes with a new immutable generation id", async () => {
    const slotKey = "2026-10-07T10:30[America/Los_Angeles]";
    const first = ports({
      renderCalendarView: vi.fn().mockRejectedValue(new Error("timeout"))
    });

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:30:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      first
    );

    expect(first.failGeneration).toHaveBeenCalledWith(
      slotKey,
      "CALENDAR_VIEW_RENDER_FAILED",
      "timeout",
      "2026-10-07T17:45:00.000Z"
    );

    const retry = ports({
      claimRetry: vi.fn().mockResolvedValue({ slotKey }),
      prepareGeneration: vi.fn().mockResolvedValue(undefined)
    });
    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:45:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      retry
    );

    expect(result).toMatchObject({ status: "published", slotKey });
    expect(retry.claimSlot).not.toHaveBeenCalled();
    expect(retry.prepareGeneration).toHaveBeenCalledOnce();
    expect(retry.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        generationId: "20261007T174500Z",
        slotKey
      })
    );
  });

  test("a retry failure is final and is not scheduled a second time", async () => {
    const slotKey = "2026-10-07T10:30[America/Los_Angeles]";
    const boundary = ports({
      claimRetry: vi.fn().mockResolvedValue({ slotKey }),
      renderLunchView: vi.fn().mockRejectedValue(new Error("still broken"))
    });

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:45:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(boundary.failGeneration).toHaveBeenCalledWith(
      slotKey,
      "LUNCH_VIEW_RENDER_FAILED",
      "still broken",
      null
    );
  });

  test("next wake follows local slots across daylight-saving changes", () => {
    const configuration = {
      latitude: 37.3382,
      longitude: -121.8863,
      timezone: "America/Los_Angeles",
      slots: ["06:30", "10:30", "15:00", "19:00"]
    };

    expect(
      secondsUntilNextSlot(new Date("2026-03-08T03:00:00Z"), configuration)
    ).toBe(37_800);
    expect(
      secondsUntilNextSlot(new Date("2026-11-01T02:00:00Z"), configuration)
    ).toBe(45_000);
  });

  test("the repeated fall-back local minute has one canonical idempotency key", async () => {
    const claimSlot = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const boundary = ports({ claimSlot });
    const configuration = {
      latitude: 37.3382,
      longitude: -121.8863,
      timezone: "America/Los_Angeles",
      slots: ["01:30"]
    };

    await runScheduledWeatherGeneration(
      {
        now: new Date("2026-11-01T08:30:00Z"),
        configuration,
        maximumImageBytes: 1_000_000
      },
      boundary
    );
    const duplicate = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-11-01T09:30:00Z"),
        configuration,
        maximumImageBytes: 1_000_000
      },
      boundary
    );

    expect(claimSlot).toHaveBeenNthCalledWith(
      1,
      "2026-11-01T01:30[America/Los_Angeles]"
    );
    expect(claimSlot).toHaveBeenNthCalledWith(
      2,
      "2026-11-01T01:30[America/Los_Angeles]"
    );
    expect(duplicate.status).toBe("duplicate");
    expect(
      secondsUntilNextSlot(new Date("2026-11-01T08:30:00Z"), configuration)
    ).toBe(90_000);
    expect(
      secondsUntilNextSlot(new Date("2026-11-01T09:15:00Z"), configuration)
    ).toBe(87_300);
  });

  test("a nonexistent spring-forward local minute is skipped instead of shifted", () => {
    expect(
      secondsUntilNextSlot(new Date("2026-03-08T09:59:00Z"), {
        latitude: 37.3382,
        longitude: -121.8863,
        timezone: "America/Los_Angeles",
        slots: ["02:30"]
      })
    ).toBe(84_660);
  });
});

import { describe, expect, test, vi } from "vitest";
import { PNG } from "pngjs";
import {
  runScheduledWeatherGeneration,
  secondsUntilNextSlot,
  type ScheduledGenerationPorts
} from "../src/generation";
import type { WeatherSnapshot } from "../src/weather";
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

function png(width = 800, height = 480, luminance = 0): Uint8Array {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = luminance;
    image.data[offset + 1] = luminance;
    image.data[offset + 2] = luminance;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
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
    renderDailyBrief: vi.fn().mockResolvedValue(png()),
    renderCalendarView: vi.fn().mockResolvedValue(png()),
    publish: vi.fn().mockResolvedValue(undefined),
    recordSourceFailure: vi.fn().mockResolvedValue(undefined),
    failGeneration: vi.fn().mockResolvedValue(undefined),
    ...overrides
  } as ScheduledGenerationPorts;
}

describe("scheduled weather generation", () => {
  test("a due local slot renders and atomically publishes the two dashboard views", async () => {
    const boundary = ports();

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
    expect(boundary.renderDailyBrief).toHaveBeenCalledWith({
      weather: WEATHER,
      calendar: [],
      stale: false,
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(boundary.renderCalendarView).toHaveBeenCalledWith({
      calendar: [],
      timezone: "America/Los_Angeles",
      weather: {
        today: WEATHER.today,
        tomorrow: WEATHER.tomorrow
      },
      stale: false,
      updatedAt: "2026-10-07T17:30:00.000Z"
    });
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
        }
      ],
      width: 800,
      height: 480,
      weather: WEATHER,
      generatedAt: "2026-10-07T17:30:00.000Z"
    });
  });

  test("a non-due cron invocation does not fetch sources", async () => {
    const boundary = ports();

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
    expect(boundary.fetchWeather).not.toHaveBeenCalled();
  });

  test("a protected manual generation runs outside a configured slot", async () => {
    const boundary = ports();
    const result = await runScheduledWeatherGeneration(
      {
        now: new Date("2026-10-07T17:31:00Z"),
        configuration: {
          latitude: 37.3382,
          longitude: -121.8863,
          timezone: "America/Los_Angeles",
          slots: ["10:30"]
        },
        maximumImageBytes: 1_000_000,
        forcedSlotKey: "manual-2026-10-07T17:31:00.000Z"
      },
      boundary
    );

    expect(result).toMatchObject({
      status: "published",
      slotKey: "manual-2026-10-07T17:31:00.000Z"
    });
    expect(boundary.claimSlot).toHaveBeenCalledWith(
      "manual-2026-10-07T17:31:00.000Z"
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
      calendar: [],
      stale: true,
      staleAgeMinutes: 180,
      timezone: "America/Los_Angeles",
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
      timezone: "America/Los_Angeles",
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

  test("a render containing a fifth gray does not advance publication", async () => {
    const boundary = ports({
      renderCalendarView: vi.fn().mockResolvedValue(png(800, 480, 128))
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
      code: "RENDERED_IMAGE_INVALID"
    });
    expect(boundary.publish).not.toHaveBeenCalled();
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
      claimRetry: vi.fn().mockResolvedValue({ slotKey })
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
      renderCalendarView: vi.fn().mockRejectedValue(new Error("still broken"))
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
      "CALENDAR_VIEW_RENDER_FAILED",
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

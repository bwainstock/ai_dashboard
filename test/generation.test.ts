import { describe, expect, test, vi } from "vitest";
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
    fetchWeather: vi.fn().mockResolvedValue(WEATHER),
    loadLatestWeather: vi.fn().mockResolvedValue(null),
    saveWeather: vi.fn().mockResolvedValue(undefined),
    renderDailyBrief: vi.fn().mockResolvedValue(png()),
    publish: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

describe("scheduled weather generation", () => {
  test("a due local slot normalizes, renders, validates, and publishes an immutable Daily Brief", async () => {
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
      slotKey: "2026-10-07T17:30:00.000Z",
      filename: "daily-brief-20261007T173000Z.png",
      nextWakeSeconds: 16_200
    });
    expect(boundary.renderDailyBrief).toHaveBeenCalledWith({
      weather: WEATHER,
      stale: false,
      updatedAt: "2026-10-07T17:30:00.000Z"
    });
    expect(boundary.publish).toHaveBeenCalledWith({
      slotKey: "2026-10-07T17:30:00.000Z",
      filename: "daily-brief-20261007T173000Z.png",
      objectKey: "generations/20261007T173000Z/daily-brief.png",
      image: expect.any(Uint8Array),
      width: 800,
      height: 480,
      weather: WEATHER,
      generatedAt: "2026-10-07T17:30:00.000Z"
    });
  });

  test("an explicit upstream failure publishes the last valid weather as stale", async () => {
    const failure = Object.assign(new Error("Open-Meteo returned HTTP 503"), {
      code: "WEATHER_UPSTREAM_HTTP"
    });

    const boundary = ports({
      fetchWeather: vi.fn().mockRejectedValue(failure),
      loadLatestWeather: vi.fn().mockResolvedValue(WEATHER)
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
      updatedAt: "2026-10-07T22:00:00.000Z"
    });
    expect(boundary.recordFailure).toHaveBeenCalledWith(
      "2026-10-07T22:00:00.000Z",
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
      loadLatestCalendar: vi.fn().mockResolvedValue([]),
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
      slotKey: "2026-10-08T02:00:00.000Z",
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
    expect(boundary.recordFailure).toHaveBeenCalledWith(
      "2026-10-07T17:30:00.000Z",
      "RENDERED_IMAGE_INVALID",
      expect.any(String)
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
});

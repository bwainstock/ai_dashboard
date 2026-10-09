import { describe, expect, test, vi } from "vitest";
import { fetchWeather, WeatherAdapterError } from "../src/weather";

describe("Open-Meteo weather adapter", () => {
  test("normalizes current, today, and tomorrow weather", async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        current: {
          time: "2026-10-07T10:15",
          temperature_2m: 68,
          weather_code: 1
        },
        daily: {
          time: ["2026-10-07", "2026-10-08"],
          weather_code: [2, 61],
          temperature_2m_max: [75, 64],
          temperature_2m_min: [55, 51],
          precipitation_probability_max: [10, 70]
        }
      })
    );

    const weather = await fetchWeather(
      { latitude: 37.3382, longitude: -121.8863 },
      request
    );

    expect(weather).toEqual({
      observedAt: "2026-10-07T10:15",
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
    });
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining(
        "latitude=37.3382&longitude=-121.8863&timezone=America%2FLos_Angeles"
      ),
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
  });

  test("reports an explicit upstream HTTP failure", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));

    await expect(
      fetchWeather({ latitude: 37.3382, longitude: -121.8863 }, request)
    ).rejects.toEqual(
      new WeatherAdapterError(
        "WEATHER_UPSTREAM_HTTP",
        "Open-Meteo returned HTTP 503"
      )
    );
  });

  test("reports an explicit invalid-response failure", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ daily: {} }));

    await expect(
      fetchWeather({ latitude: 37.3382, longitude: -121.8863 }, request)
    ).rejects.toEqual(
      new WeatherAdapterError(
        "WEATHER_INVALID_RESPONSE",
        "Open-Meteo response is missing required current values"
      )
    );
  });

  test("reports an explicit network failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("connection reset"));

    await expect(
      fetchWeather({ latitude: 37.3382, longitude: -121.8863 }, request)
    ).rejects.toEqual(
      new WeatherAdapterError(
        "WEATHER_UPSTREAM_NETWORK",
        "Open-Meteo request failed: connection reset"
      )
    );
  });
});

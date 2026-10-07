export interface WeatherLocation {
  latitude: number;
  longitude: number;
}

export interface ForecastDay {
  date: string;
  condition: string;
  high: number;
  low: number;
  precipitationProbability: number;
}

export interface WeatherSnapshot {
  observedAt: string;
  current: {
    temperature: number;
    condition: string;
  };
  today: ForecastDay;
  tomorrow: ForecastDay;
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type WeatherAdapterErrorCode = Extract<
  OperationalCode,
  | "WEATHER_UPSTREAM_HTTP"
  | "WEATHER_UPSTREAM_NETWORK"
  | "WEATHER_INVALID_RESPONSE"
>;

export class WeatherAdapterError extends Error {
  constructor(
    readonly code: WeatherAdapterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "WeatherAdapterError";
  }
}

const CONDITIONS: Record<number, string> = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Cloudy",
  45: "Fog",
  48: "Fog",
  51: "Drizzle",
  53: "Drizzle",
  55: "Drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Heavy showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms",
  99: "Thunderstorms"
};

function condition(code: number): string {
  return CONDITIONS[code] ?? "Unknown";
}

function numberAt(values: unknown, index: number): number {
  if (!Array.isArray(values) || typeof values[index] !== "number") {
    throw new Error("Open-Meteo response is missing required daily values");
  }
  return values[index];
}

function stringAt(values: unknown, index: number): string {
  if (!Array.isArray(values) || typeof values[index] !== "string") {
    throw new Error("Open-Meteo response is missing required daily dates");
  }
  return values[index];
}

export async function fetchWeather(
  location: WeatherLocation,
  request: Fetch = fetch
): Promise<WeatherSnapshot> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(location.latitude));
  url.searchParams.set("longitude", String(location.longitude));
  url.searchParams.set("timezone", "America/Los_Angeles");
  url.searchParams.set("forecast_days", "2");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max"
    ].join(",")
  );

  let response: Response;
  try {
    response = await request(url.toString(), {
      headers: { accept: "application/json" }
    });
  } catch (error) {
    throw new WeatherAdapterError(
      "WEATHER_UPSTREAM_NETWORK",
      `Open-Meteo request failed: ${
        error instanceof Error ? error.message : "network error"
      }`
    );
  }
  if (!response.ok) {
    throw new WeatherAdapterError(
      "WEATHER_UPSTREAM_HTTP",
      `Open-Meteo returned HTTP ${response.status}`
    );
  }

  try {
    const data = (await response.json()) as {
      current?: Record<string, unknown>;
      daily?: Record<string, unknown>;
    };
    const current = data.current;
    const daily = data.daily;
    if (
      !current ||
      !daily ||
      typeof current.time !== "string" ||
      typeof current.temperature_2m !== "number" ||
      typeof current.weather_code !== "number"
    ) {
      throw new Error("Open-Meteo response is missing required current values");
    }

    const day = (index: number): ForecastDay => ({
      date: stringAt(daily.time, index),
      condition: condition(numberAt(daily.weather_code, index)),
      high: numberAt(daily.temperature_2m_max, index),
      low: numberAt(daily.temperature_2m_min, index),
      precipitationProbability: numberAt(
        daily.precipitation_probability_max,
        index
      )
    });

    return {
      observedAt: current.time,
      current: {
        temperature: current.temperature_2m,
        condition: condition(current.weather_code)
      },
      today: day(0),
      tomorrow: day(1)
    };
  } catch (error) {
    if (error instanceof WeatherAdapterError) throw error;
    throw new WeatherAdapterError(
      "WEATHER_INVALID_RESPONSE",
      error instanceof Error ? error.message : "Open-Meteo returned invalid JSON"
    );
  }
}
import type { OperationalCode } from "./operational-codes";

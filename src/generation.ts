import type { WeatherLocation, WeatherSnapshot } from "./weather";
import type { CalendarEvent } from "./calendar";

export interface DashboardConfiguration extends WeatherLocation {
  timezone: string;
  slots: string[];
}

export interface DailyBriefWeatherModel {
  weather: WeatherSnapshot;
  calendar?: CalendarEvent[];
  stale: boolean;
  updatedAt: string;
}

export interface Publication {
  slotKey: string;
  filename: string;
  objectKey: string;
  image: Uint8Array;
  width: number;
  height: number;
  weather: WeatherSnapshot;
  generatedAt: string;
}

export interface ScheduledGenerationPorts {
  claimSlot(slotKey: string): Promise<boolean>;
  fetchWeather(location: WeatherLocation): Promise<WeatherSnapshot>;
  loadLatestWeather(): Promise<WeatherSnapshot | null>;
  saveWeather(snapshot: WeatherSnapshot, fetchedAt: string): Promise<void>;
  fetchCalendar?(): Promise<CalendarEvent[]>;
  loadLatestCalendar?(): Promise<CalendarEvent[]>;
  saveCalendar?(events: CalendarEvent[], fetchedAt: string): Promise<void>;
  renderDailyBrief(model: DailyBriefWeatherModel): Promise<Uint8Array>;
  publish(publication: Publication): Promise<void>;
  recordFailure(slotKey: string, code: string, message: string): Promise<void>;
}

export interface ScheduledGenerationInput {
  now: Date;
  configuration: DashboardConfiguration;
  maximumImageBytes: number;
}

export type ScheduledGenerationResult =
  | { status: "not_due"; nextWakeSeconds: number }
  | { status: "duplicate"; slotKey: string; nextWakeSeconds: number }
  | {
      status: "published";
      slotKey: string;
      filename: string;
      nextWakeSeconds: number;
    }
  | {
      status: "failed";
      slotKey: string;
      code: string;
      nextWakeSeconds: number;
    };

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function localParts(date: Date, timezone: string): LocalParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)])
  );
  return values as unknown as LocalParts;
}

function instantForLocal(
  date: Pick<LocalParts, "year" | "month" | "day">,
  slot: string,
  timezone: string
): Date {
  const [hour, minute] = slot.split(":").map(Number);
  const desired = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute
  );
  let timestamp = desired;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = localParts(new Date(timestamp), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute
    );
    timestamp += desired - actualAsUtc;
  }
  return new Date(timestamp);
}

function addLocalDays(
  date: Pick<LocalParts, "year" | "month" | "day">,
  days: number
): Pick<LocalParts, "year" | "month" | "day"> {
  const value = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate()
  };
}

export function secondsUntilNextSlot(
  now: Date,
  configuration: DashboardConfiguration
): number {
  const today = localParts(now, configuration.timezone);
  const candidates = [0, 1].flatMap((days) =>
    configuration.slots.map((slot) =>
      instantForLocal(addLocalDays(today, days), slot, configuration.timezone)
    )
  );
  const next = candidates
    .filter((candidate) => candidate.getTime() > now.getTime())
    .sort((left, right) => left.getTime() - right.getTime())[0];
  if (!next) throw new Error("Weather schedule must contain a future slot");
  return Math.ceil((next.getTime() - now.getTime()) / 1000);
}

function dueSlot(
  now: Date,
  configuration: DashboardConfiguration
): Date | null {
  const local = localParts(now, configuration.timezone);
  const current = `${String(local.hour).padStart(2, "0")}:${String(
    local.minute
  ).padStart(2, "0")}`;
  if (!configuration.slots.includes(current)) return null;
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000);
}

function pngDimensions(image: Uint8Array): [number, number] | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    image.byteLength < 24 ||
    !signature.every((value, index) => image[index] === value)
  ) {
    return null;
  }
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

function compactTimestamp(date: Date): string {
  return date.toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
}

export async function runScheduledWeatherGeneration(
  input: ScheduledGenerationInput,
  ports: ScheduledGenerationPorts
): Promise<ScheduledGenerationResult> {
  const nextWakeSeconds = secondsUntilNextSlot(input.now, input.configuration);
  const slot = dueSlot(input.now, input.configuration);
  if (!slot) return { status: "not_due", nextWakeSeconds };

  const slotKey = slot.toISOString();
  if (!(await ports.claimSlot(slotKey))) {
    return { status: "duplicate", slotKey, nextWakeSeconds };
  }

  let weather: WeatherSnapshot;
  let stale = false;
  try {
    weather = await ports.fetchWeather(input.configuration);
    await ports.saveWeather(weather, input.now.toISOString());
  } catch (error) {
    const code =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "WEATHER_FETCH_FAILED";
    const message =
      error instanceof Error ? error.message : "Weather fetch failed";
    await ports.recordFailure(slotKey, code, message);
    const previous = await ports.loadLatestWeather();
    if (!previous) {
      return { status: "failed", slotKey, code, nextWakeSeconds };
    }
    weather = previous;
    stale = true;
  }
  const model = {
    weather,
    stale,
    updatedAt: input.now.toISOString()
  };
  if (
    ports.fetchCalendar &&
    ports.loadLatestCalendar &&
    ports.saveCalendar
  ) {
    try {
      const calendar = await ports.fetchCalendar();
      await ports.saveCalendar(calendar, input.now.toISOString());
      Object.assign(model, { calendar });
    } catch (error) {
      const previous = await ports.loadLatestCalendar();
      Object.assign(model, { calendar: previous });
      await ports.recordFailure(
        slotKey,
        error &&
          typeof error === "object" &&
          "code" in error &&
          typeof error.code === "string"
          ? error.code
          : "CALENDAR_FETCH_FAILED",
        error instanceof Error ? error.message : "Calendar fetch failed"
      );
    }
  }
  let image: Uint8Array;
  try {
    image = await ports.renderDailyBrief(model);
  } catch (error) {
    const code = "DAILY_BRIEF_RENDER_FAILED";
    await ports.recordFailure(
      slotKey,
      code,
      error instanceof Error ? error.message : "Daily Brief rendering failed"
    );
    return { status: "failed", slotKey, code, nextWakeSeconds };
  }
  const dimensions = pngDimensions(image);
  if (
    dimensions?.[0] !== 800 ||
    dimensions[1] !== 480 ||
    image.byteLength > input.maximumImageBytes
  ) {
    const code = "RENDERED_IMAGE_INVALID";
    await ports.recordFailure(
      slotKey,
      code,
      "Daily Brief must be an 800x480 PNG within the configured size limit"
    );
    return { status: "failed", slotKey, code, nextWakeSeconds };
  }

  const timestamp = compactTimestamp(slot);
  const filename = `daily-brief-${timestamp}.png`;
  try {
    await ports.publish({
      slotKey,
      filename,
      objectKey: `generations/${timestamp}/daily-brief.png`,
      image,
      width: 800,
      height: 480,
      weather,
      generatedAt: input.now.toISOString()
    });
  } catch (error) {
    const code = "GENERATION_PUBLICATION_FAILED";
    await ports.recordFailure(
      slotKey,
      code,
      error instanceof Error ? error.message : "Generation publication failed"
    );
    return { status: "failed", slotKey, code, nextWakeSeconds };
  }

  return { status: "published", slotKey, filename, nextWakeSeconds };
}

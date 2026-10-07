import type { WeatherLocation, WeatherSnapshot } from "./weather";
import type { CalendarEvent } from "./calendar";
import type { CalendarViewModel } from "./calendar-view";
import { lunchViewModel, type LunchViewModel } from "./lunch-view";
import type { NoticesViewModel } from "./notices-view";
import {
  classifyLunchEntree,
  type LunchClassifierPorts,
  type LunchIcon,
  type LunchSnapshot
} from "./lunch";

export interface DashboardConfiguration extends WeatherLocation {
  timezone: string;
  slots: string[];
}

export interface Snapshot<T> {
  snapshot: T;
  fetchedAt: string;
}

export interface DailyBriefWeatherModel {
  weather: WeatherSnapshot;
  calendar?: CalendarEvent[];
  calendarUnavailable?: boolean;
  calendarStaleAgeMinutes?: number;
  stale: boolean;
  staleAgeMinutes?: number;
  lunch: DailyBriefLunchModel;
  notices?: DailyBriefNotice[];
  privateNoticeMarkers?: Array<{ accountId: "mom" | "dad" }>;
  updatedAt: string;
}

export interface DailyBriefNotice {
  category: "school" | "childcare" | "activity" | "household";
  summary: string;
  relevantDate: string | null;
  action: string | null;
  senderOrganization: string;
}

export interface DailyBriefLunchModel {
  status:
    | "available"
    | "no_menu"
    | "closed"
    | "schema_failure"
    | "adapter_failure";
  stale: boolean;
  staleAgeMinutes?: number;
  entrees: Array<{ name: string; icon: LunchIcon }>;
}

export interface Publication {
  generationId: string;
  slotKey: string;
  views: Array<{
    viewType: "daily_brief" | "calendar" | "lunch" | "notices";
    filename: string;
    objectKey: string;
    image: Uint8Array;
  }>;
  width: number;
  height: number;
  weather: WeatherSnapshot;
  lunch: LunchSnapshot;
  generatedAt: string;
}

export interface ScheduledGenerationPorts {
  claimSlot(slotKey: string): Promise<boolean>;
  claimRetry(now: string): Promise<{ slotKey: string } | null>;
  fetchWeather(location: WeatherLocation): Promise<WeatherSnapshot>;
  loadLatestWeather(): Promise<Snapshot<WeatherSnapshot> | null>;
  saveWeather(snapshot: WeatherSnapshot, fetchedAt: string): Promise<void>;
  fetchLunch(): Promise<LunchSnapshot>;
  loadLatestLunch(): Promise<Snapshot<LunchSnapshot> | null>;
  saveLunch(snapshot: LunchSnapshot, fetchedAt: string): Promise<void>;
  loadCachedLunchIcon(entreeKey: string): Promise<string | null>;
  saveCachedLunchIcon(entreeKey: string, icon: LunchIcon): Promise<void>;
  classifyLunchWithAi?: NonNullable<LunchClassifierPorts["classifyWithAi"]>;
  fetchCalendar?(): Promise<CalendarEvent[]>;
  loadLatestCalendar?(): Promise<Snapshot<CalendarEvent[]> | null>;
  saveCalendar?(events: CalendarEvent[], fetchedAt: string): Promise<void>;
  loadNotices?(): Promise<DailyBriefNotice[]>;
  loadPrivateNoticeMarkers?(): Promise<Array<{ accountId: "mom" | "dad" }>>;
  renderDailyBrief(model: DailyBriefWeatherModel): Promise<Uint8Array>;
  renderCalendarView(model: CalendarViewModel): Promise<Uint8Array>;
  renderLunchView(model: LunchViewModel): Promise<Uint8Array>;
  renderNoticesView(model: NoticesViewModel): Promise<Uint8Array>;
  publish(publication: Publication): Promise<void>;
  recordSourceFailure(
    slotKey: string,
    source: "weather" | "calendar" | "lunch",
    code: string,
    message: string
  ): Promise<void>;
  failGeneration(
    slotKey: string,
    code: string,
    message: string,
    retryAt: string | null
  ): Promise<void>;
}

export interface ScheduledGenerationInput {
  now: Date;
  configuration: DashboardConfiguration;
  maximumImageBytes: number;
  retryDelayMinutes?: number;
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

function localMinute(parts: LocalParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(
    2,
    "0"
  )}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(
    2,
    "0"
  )}:${String(parts.minute).padStart(2, "0")}`;
}

function configuredLocalMinute(
  date: Date,
  configuration: DashboardConfiguration
): string | null {
  const parts = localParts(date, configuration.timezone);
  const time = `${String(parts.hour).padStart(2, "0")}:${String(
    parts.minute
  ).padStart(2, "0")}`;
  return configuration.slots.includes(time) ? localMinute(parts) : null;
}

export function secondsUntilNextSlot(
  now: Date,
  configuration: DashboardConfiguration
): number {
  const start = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  const seen = new Set<string>();
  for (let offset = 0; offset <= 180; offset += 1) {
    const previous = new Date(now.getTime() - offset * 60_000);
    const previousLocalSlot = configuredLocalMinute(previous, configuration);
    if (previousLocalSlot) seen.add(previousLocalSlot);
  }
  for (let offset = 0; offset < 60 * 72; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const local = configuredLocalMinute(candidate, configuration);
    if (!local || seen.has(local)) continue;
    seen.add(local);
    return Math.ceil((candidate.getTime() - now.getTime()) / 1000);
  }
  throw new Error("Weather schedule must contain a future slot");
}

function dueSlotKey(
  now: Date,
  configuration: DashboardConfiguration
): string | null {
  const minute = configuredLocalMinute(now, configuration);
  return minute ? `${minute}[${configuration.timezone}]` : null;
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

function localDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function staleAgeMinutes(now: Date, fetchedAt: string): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - new Date(fetchedAt).getTime()) / 60_000)
  );
}

function errorDetails(error: unknown, fallbackCode: string, fallback: string) {
  return {
    code:
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : fallbackCode,
    message: error instanceof Error ? error.message : fallback
  };
}

async function lunchModel(
  snapshot: LunchSnapshot | null,
  date: string,
  status: DailyBriefLunchModel["status"] | null,
  classifier: LunchClassifierPorts,
  age?: number
): Promise<DailyBriefLunchModel> {
  const day = snapshot?.days.find((candidate) => candidate.date === date);
  const entrees = await Promise.all(
    (day?.entrees ?? []).map(async (name) => ({
      name,
      icon: await classifyLunchEntree(name, classifier)
    }))
  );
  if (status) {
    return {
      status,
      stale: age !== undefined,
      ...(age === undefined ? {} : { staleAgeMinutes: age }),
      entrees
    };
  }
  if (!day || (day.status === "menu" && day.entrees.length === 0)) {
    return { status: "no_menu", stale: false, entrees: [] };
  }
  if (day.status === "closed") {
    return { status: "closed", stale: false, entrees: [] };
  }
  return { status: "available", stale: false, entrees };
}

export async function runScheduledWeatherGeneration(
  input: ScheduledGenerationInput,
  ports: ScheduledGenerationPorts
): Promise<ScheduledGenerationResult> {
  const nextWakeSeconds = secondsUntilNextSlot(input.now, input.configuration);
  const scheduledSlotKey = dueSlotKey(input.now, input.configuration);
  let slotKey: string;
  let retry = false;

  if (scheduledSlotKey) {
    slotKey = scheduledSlotKey;
    if (!(await ports.claimSlot(slotKey))) {
      return { status: "duplicate", slotKey, nextWakeSeconds };
    }
  } else {
    const retryClaim = await ports.claimRetry(input.now.toISOString());
    if (!retryClaim) return { status: "not_due", nextWakeSeconds };
    slotKey = retryClaim.slotKey;
    retry = true;
  }

  const configuredRetryDelay = input.retryDelayMinutes ?? 15;
  const retryDelayMinutes =
    Number.isInteger(configuredRetryDelay) && configuredRetryDelay > 0
      ? configuredRetryDelay
      : 15;
  const retryAt = retry
    ? null
    : new Date(
        input.now.getTime() + retryDelayMinutes * 60_000
      ).toISOString();
  const fail = async (code: string, message: string) => {
    await ports.failGeneration(slotKey, code, message, retryAt);
    return { status: "failed", slotKey, code, nextWakeSeconds } as const;
  };

  let weather: WeatherSnapshot;
  let weatherAge: number | undefined;
  try {
    weather = await ports.fetchWeather(input.configuration);
    await ports.saveWeather(weather, input.now.toISOString());
  } catch (error) {
    const details = errorDetails(
      error,
      "WEATHER_FETCH_FAILED",
      "Weather fetch failed"
    );
    await ports.recordSourceFailure(
      slotKey,
      "weather",
      details.code,
      details.message
    );
    const previous = await ports.loadLatestWeather();
    if (!previous) return fail(details.code, details.message);
    weather = previous.snapshot;
    weatherAge = staleAgeMinutes(input.now, previous.fetchedAt);
  }

  const classifier: LunchClassifierPorts = {
    loadCached: ports.loadCachedLunchIcon,
    saveCached: ports.saveCachedLunchIcon,
    classifyWithAi: ports.classifyLunchWithAi
  };
  let lunch: LunchSnapshot;
  let renderedLunch: DailyBriefLunchModel;
  let lunchFailure: "schema_failure" | "adapter_failure" | null = null;
  let lunchAge: number | undefined;
  try {
    lunch = await ports.fetchLunch();
    await ports.saveLunch(lunch, input.now.toISOString());
    renderedLunch = await lunchModel(
      lunch,
      localDate(input.now, input.configuration.timezone),
      null,
      classifier
    );
  } catch (error) {
    const details = errorDetails(
      error,
      "LUNCH_UPSTREAM_NETWORK",
      "Lunch fetch failed"
    );
    await ports.recordSourceFailure(
      slotKey,
      "lunch",
      details.code,
      details.message
    );
    const previous = await ports.loadLatestLunch();
    lunch = previous?.snapshot ?? { days: [] };
    lunchAge = previous
      ? staleAgeMinutes(input.now, previous.fetchedAt)
      : undefined;
    lunchFailure =
      details.code === "LUNCH_INVALID_RESPONSE"
        ? "schema_failure"
        : "adapter_failure";
    renderedLunch = await lunchModel(
      lunch,
      localDate(input.now, input.configuration.timezone),
      lunchFailure,
      classifier,
      lunchAge
    );
  }

  const model: DailyBriefWeatherModel = {
    weather,
    stale: weatherAge !== undefined,
    ...(weatherAge === undefined ? {} : { staleAgeMinutes: weatherAge }),
    lunch: renderedLunch,
    updatedAt: input.now.toISOString()
  };
  const notices = ports.loadNotices ? await ports.loadNotices() : [];
  const privateNoticeMarkers = ports.loadPrivateNoticeMarkers
    ? await ports.loadPrivateNoticeMarkers()
    : [];
  if (ports.loadNotices) model.notices = notices.slice(0, 2);
  if (ports.loadPrivateNoticeMarkers) {
    model.privateNoticeMarkers = privateNoticeMarkers;
  }
  let calendar: CalendarEvent[] = [];
  let calendarAge: number | undefined;
  let calendarUnavailable = false;
  if (ports.fetchCalendar && ports.loadLatestCalendar && ports.saveCalendar) {
    try {
      calendar = await ports.fetchCalendar();
      await ports.saveCalendar(calendar, input.now.toISOString());
      model.calendar = calendar;
    } catch (error) {
      const details = errorDetails(
        error,
        "CALENDAR_FETCH_FAILED",
        "Calendar fetch failed"
      );
      const previous = await ports.loadLatestCalendar();
      calendar = previous?.snapshot ?? [];
      calendarUnavailable = !previous;
      calendarAge = previous
        ? staleAgeMinutes(input.now, previous.fetchedAt)
        : undefined;
      model.calendar = calendar;
      model.calendarUnavailable = calendarUnavailable;
      if (calendarAge !== undefined) {
        model.calendarStaleAgeMinutes = calendarAge;
      }
      await ports.recordSourceFailure(
        slotKey,
        "calendar",
        details.code,
        details.message
      );
    }
  }

  let image: Uint8Array;
  try {
    image = await ports.renderDailyBrief(model);
  } catch (error) {
    return fail(
      "DAILY_BRIEF_RENDER_FAILED",
      error instanceof Error ? error.message : "Daily Brief rendering failed"
    );
  }
  let calendarImage: Uint8Array;
  try {
    calendarImage = await ports.renderCalendarView({
      calendar,
      timezone: input.configuration.timezone,
      stale: calendarAge !== undefined,
      ...(calendarAge === undefined
        ? {}
        : { staleAgeMinutes: calendarAge }),
      ...(calendarUnavailable ? { unavailable: true } : {}),
      updatedAt: input.now.toISOString()
    });
  } catch (error) {
    return fail(
      "CALENDAR_VIEW_RENDER_FAILED",
      error instanceof Error ? error.message : "Calendar View rendering failed"
    );
  }
  let lunchImage: Uint8Array;
  try {
    lunchImage = await ports.renderLunchView(
      await lunchViewModel(
        lunch,
        input.now,
        input.configuration.timezone,
        lunchFailure,
        classifier,
        lunchAge
      )
    );
  } catch (error) {
    return fail(
      "LUNCH_VIEW_RENDER_FAILED",
      error instanceof Error ? error.message : "Lunch View rendering failed"
    );
  }
  let noticesImage: Uint8Array;
  try {
    noticesImage = await ports.renderNoticesView({
      notices: notices.slice(0, 8),
      privateNoticeMarkers,
      timezone: input.configuration.timezone,
      updatedAt: input.now.toISOString()
    });
  } catch (error) {
    return fail(
      "NOTICES_VIEW_RENDER_FAILED",
      error instanceof Error ? error.message : "Notices View rendering failed"
    );
  }

  const images = [image, calendarImage, lunchImage, noticesImage];
  if (
    images.some((candidate) => {
      const dimensions = pngDimensions(candidate);
      return (
        dimensions?.[0] !== 800 ||
        dimensions[1] !== 480 ||
        candidate.byteLength > input.maximumImageBytes
      );
    })
  ) {
    return fail(
      "RENDERED_IMAGE_INVALID",
      "Every view must be an 800x480 PNG within the configured size limit"
    );
  }

  const generationId = compactTimestamp(input.now);
  const filename = `daily-brief-${generationId}.png`;
  try {
    await ports.publish({
      generationId,
      slotKey,
      views: [
        {
          viewType: "daily_brief",
          filename,
          objectKey: `generations/${generationId}/daily-brief.png`,
          image
        },
        {
          viewType: "calendar",
          filename: `calendar-view-${generationId}.png`,
          objectKey: `generations/${generationId}/calendar-view.png`,
          image: calendarImage
        },
        {
          viewType: "lunch",
          filename: `lunch-view-${generationId}.png`,
          objectKey: `generations/${generationId}/lunch-view.png`,
          image: lunchImage
        },
        {
          viewType: "notices",
          filename: `notices-view-${generationId}.png`,
          objectKey: `generations/${generationId}/notices-view.png`,
          image: noticesImage
        }
      ],
      width: 800,
      height: 480,
      weather,
      lunch,
      generatedAt: input.now.toISOString()
    });
  } catch (error) {
    return fail(
      "GENERATION_PUBLICATION_FAILED",
      error instanceof Error ? error.message : "Generation publication failed"
    );
  }

  return { status: "published", slotKey, filename, nextWakeSeconds };
}

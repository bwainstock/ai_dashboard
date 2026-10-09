export const LUNCH_ICONS = [
  "pizza",
  "taco",
  "sandwich",
  "chicken",
  "pasta",
  "salad",
  "generic"
] as const;

export type LunchIcon = (typeof LUNCH_ICONS)[number];

export interface LunchDay {
  date: string;
  status: "menu" | "closed";
  entrees: string[];
}

export interface LunchSnapshot {
  days: LunchDay[];
}

export interface LunchClassifierPorts {
  loadCached(entreeKey: string): Promise<string | null>;
  saveCached(entreeKey: string, icon: LunchIcon): Promise<void>;
  classifyWithAi?(request: {
    entree: string;
    allowedIcons: typeof LUNCH_ICONS;
  }): Promise<unknown>;
}

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface MealViewerRequestOptions {
  now?: Date;
  timezone?: string;
  timeoutMilliseconds?: number;
}

export type LunchAdapterErrorCode = Extract<
  OperationalCode,
  "LUNCH_UPSTREAM_HTTP" | "LUNCH_UPSTREAM_NETWORK" | "LUNCH_INVALID_RESPONSE"
>;

export class LunchAdapterError extends Error {
  constructor(
    readonly code: LunchAdapterErrorCode,
    message: string
  ) {
    super(message);
    this.name = "LunchAdapterError";
  }
}

const EXACT_ICONS: Readonly<Record<string, LunchIcon>> = {
  "cheese pizza": "pizza",
  "pepperoni pizza": "pizza",
  "turkey & cheese sandwich": "sandwich"
};

const KEYWORD_ICONS: ReadonlyArray<
  readonly [LunchIcon, readonly string[]]
> = [
  ["pizza", ["pizza", "flatbread"]],
  ["taco", ["taco", "burrito", "quesadilla", "nacho"]],
  ["sandwich", ["sandwich", "burger", "hot dog", "sub"]],
  ["chicken", ["chicken", "drumstick", "tender"]],
  ["pasta", ["pasta", "penne", "spaghetti", "macaroni", "lasagna", "ravioli"]],
  ["salad", ["salad"]]
];

function entreeKey(entree: string): string {
  return entree.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function isLunchIcon(value: unknown): value is LunchIcon {
  return (
    typeof value === "string" &&
    (LUNCH_ICONS as readonly string[]).includes(value)
  );
}

export async function classifyLunchEntree(
  entree: string,
  ports: LunchClassifierPorts
): Promise<LunchIcon> {
  const key = entreeKey(entree);
  const exact = EXACT_ICONS[key];
  if (exact) return exact;
  for (const [icon, keywords] of KEYWORD_ICONS) {
    if (keywords.some((keyword) => key.includes(keyword))) return icon;
  }

  const cached = await ports.loadCached(key);
  if (isLunchIcon(cached)) return cached;
  if (!ports.classifyWithAi) return "generic";

  try {
    const classified = await ports.classifyWithAi({
      entree: entree.replaceAll(/\s+/g, " ").trim(),
      allowedIcons: LUNCH_ICONS
    });
    if (!isLunchIcon(classified)) return "generic";
    await ports.saveCached(key, classified);
    return classified;
  } catch {
    return "generic";
  }
}

function invalid(message: string): never {
  throw new LunchAdapterError("LUNCH_INVALID_RESPONSE", message);
}

function normalizedDate(value: unknown): string {
  if (typeof value !== "string") invalid("MealViewer day is missing its date");
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    invalid("MealViewer day has an invalid date");
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    invalid("MealViewer day has an invalid date");
  }
  return date;
}

function normalizedName(value: unknown): string {
  if (typeof value !== "string") {
    invalid("MealViewer menu item is missing its name");
  }
  const name = value.replaceAll(/\s+/g, " ").trim();
  if (!name || name.length > 160) {
    invalid("MealViewer menu item has an invalid name");
  }
  return name;
}

function normalizeDay(value: unknown): LunchDay {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("MealViewer menu day is invalid");
  }
  const day = value as Record<string, unknown>;
  const date = normalizedDate(day.date);
  if (typeof day.isClosed !== "boolean") {
    return invalid("MealViewer day is missing its closure state");
  }
  if (!Array.isArray(day.menuBlocks)) {
    return invalid("MealViewer day is missing menuBlocks");
  }
  if (day.isClosed) return { date, status: "closed", entrees: [] };

  const entrees: string[] = [];
  for (const blockValue of day.menuBlocks) {
    if (
      !blockValue ||
      typeof blockValue !== "object" ||
      Array.isArray(blockValue)
    ) {
      return invalid("MealViewer menu block is invalid");
    }
    const block = blockValue as Record<string, unknown>;
    if (typeof block.type !== "string" || !Array.isArray(block.menuItems)) {
      return invalid("MealViewer menu block is missing required fields");
    }
    if (block.type.toLowerCase() !== "lunch") continue;
    for (const itemValue of block.menuItems) {
      if (
        !itemValue ||
        typeof itemValue !== "object" ||
        Array.isArray(itemValue)
      ) {
        return invalid("MealViewer menu item is invalid");
      }
      const item = itemValue as Record<string, unknown>;
      if (typeof item.category !== "string") {
        return invalid("MealViewer menu item is missing its category");
      }
      const name = normalizedName(item.name);
      if (item.category.toLowerCase() === "entree") {
        entrees.push(name);
      }
    }
  }

  return {
    date,
    status: "menu",
    entrees: [...new Set(entrees)]
  };
}

function localDate(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

function mealViewerDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${month}-${day}-${year}`;
}

function datedMealViewerUrl(
  url: string,
  now: Date,
  timezone: string
): string {
  const today = localDate(now, timezone);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const monday = addDays(today, weekday === 0 ? -6 : 1 - weekday);
  const nextFriday = addDays(monday, 11);
  const schoolUrl = url.replace(/\/menu\/?$/, "").replace(/\/$/, "");
  return `${schoolUrl}/${mealViewerDate(monday)}/${mealViewerDate(nextFriday)}/1`;
}

function normalizeCurrentDay(value: unknown): LunchDay {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid("MealViewer menu day is invalid");
  }
  const day = value as Record<string, unknown>;
  if (
    !day.dateInformation ||
    typeof day.dateInformation !== "object" ||
    Array.isArray(day.dateInformation)
  ) {
    return invalid("MealViewer day is missing dateInformation");
  }
  const date = normalizedDate(
    (day.dateInformation as Record<string, unknown>).dateFull
  );
  if (!Array.isArray(day.menuBlocks)) {
    return invalid("MealViewer day is missing menuBlocks");
  }

  const lunchBlocks = day.menuBlocks.filter((blockValue) => {
    if (
      !blockValue ||
      typeof blockValue !== "object" ||
      Array.isArray(blockValue)
    ) {
      return invalid("MealViewer menu block is invalid");
    }
    const block = blockValue as Record<string, unknown>;
    if (
      typeof block.blockName !== "string" ||
      typeof block.blackedOut !== "boolean"
    ) {
      return invalid("MealViewer menu block is missing required fields");
    }
    return block.blockName.toLowerCase() === "lunch";
  }) as Array<Record<string, unknown>>;
  if (lunchBlocks.some(({ blackedOut }) => blackedOut)) {
    return { date, status: "closed", entrees: [] };
  }

  const entrees: string[] = [];
  for (const block of lunchBlocks) {
    const list = block.cafeteriaLineList;
    if (!list || typeof list !== "object" || Array.isArray(list)) {
      return invalid("MealViewer lunch block is missing cafeteriaLineList");
    }
    const lines = (list as Record<string, unknown>).data;
    if (!Array.isArray(lines)) {
      return invalid("MealViewer cafeteriaLineList is missing data");
    }
    for (const lineValue of lines) {
      if (
        !lineValue ||
        typeof lineValue !== "object" ||
        Array.isArray(lineValue)
      ) {
        return invalid("MealViewer cafeteria line is invalid");
      }
      const foodItemList = (lineValue as Record<string, unknown>).foodItemList;
      if (
        !foodItemList ||
        typeof foodItemList !== "object" ||
        Array.isArray(foodItemList)
      ) {
        return invalid("MealViewer cafeteria line is missing foodItemList");
      }
      const items = (foodItemList as Record<string, unknown>).data;
      if (!Array.isArray(items)) {
        return invalid("MealViewer foodItemList is missing data");
      }
      for (const itemValue of items) {
        if (
          !itemValue ||
          typeof itemValue !== "object" ||
          Array.isArray(itemValue)
        ) {
          return invalid("MealViewer menu item is invalid");
        }
        const item = itemValue as Record<string, unknown>;
        if (typeof item.item_Type !== "string") {
          return invalid("MealViewer menu item is missing its type");
        }
        const name = normalizedName(item.item_Name);
        if (item.item_Type.toLowerCase() === "entrees") {
          entrees.push(name);
        }
      }
    }
  }

  return {
    date,
    status: "menu",
    entrees: [...new Set(entrees)]
  };
}

export async function fetchMealViewerMenu(
  url: string,
  request: Fetch = fetch,
  options: MealViewerRequestOptions = {}
): Promise<LunchSnapshot> {
  let response: Response;
  try {
    response = await request(
      datedMealViewerUrl(
        url,
        options.now ?? new Date(),
        options.timezone ?? "UTC"
      ),
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(options.timeoutMilliseconds ?? 10_000)
      }
    );
  } catch (error) {
    throw new LunchAdapterError(
      "LUNCH_UPSTREAM_NETWORK",
      `MealViewer request failed: ${
        error instanceof Error ? error.message : "network error"
      }`
    );
  }
  if (!response.ok) {
    throw new LunchAdapterError(
      "LUNCH_UPSTREAM_HTTP",
      `MealViewer returned HTTP ${response.status}`
    );
  }

  try {
    const data = (await response.json()) as Record<string, unknown>;
    if (!data || !Array.isArray(data.menuSchedules)) {
      invalid("MealViewer response is missing menuSchedules");
    }
    const days = data.menuSchedules.map((day) =>
      day &&
      typeof day === "object" &&
      !Array.isArray(day) &&
      "dateInformation" in day
        ? normalizeCurrentDay(day)
        : normalizeDay(day)
    );
    if (new Set(days.map(({ date }) => date)).size !== days.length) {
      invalid("MealViewer response contains duplicate school dates");
    }
    return {
      days: days.sort((left, right) => left.date.localeCompare(right.date))
    };
  } catch (error) {
    if (error instanceof LunchAdapterError) throw error;
    throw new LunchAdapterError(
      "LUNCH_INVALID_RESPONSE",
      error instanceof Error ? error.message : "MealViewer returned invalid JSON"
    );
  }
}
import type { OperationalCode } from "./operational-codes";

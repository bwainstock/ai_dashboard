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
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    Number.isNaN(Date.parse(`${date}T00:00:00Z`))
  ) {
    invalid("MealViewer day has an invalid date");
  }
  return date;
}

function normalizedName(value: unknown): string {
  if (typeof value !== "string") {
    invalid("MealViewer entree is missing its name");
  }
  const name = value.replaceAll(/\s+/g, " ").trim();
  if (!name || name.length > 160) {
    invalid("MealViewer entree has an invalid name");
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
      if (item.category.toLowerCase() === "entree") {
        entrees.push(normalizedName(item.name));
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
  request: Fetch = fetch
): Promise<LunchSnapshot> {
  let response: Response;
  try {
    response = await request(url, {
      headers: { accept: "application/json" }
    });
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
    const days = data.menuSchedules.map(normalizeDay);
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

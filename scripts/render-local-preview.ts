import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import process from "node:process";
import puppeteer, { type Browser } from "puppeteer-core";
import { PNG } from "pngjs";
import { calendarViewHtml, type CalendarViewModel } from "../src/calendar-view";
import { dailyBriefHtml } from "../src/daily-brief";
import { DEVICE_LIMITS } from "../src/device-limits";
import {
  captureEpaperPng,
  configureEpaperViewport,
  EPAPER_MONOCHROME_THRESHOLD
} from "../src/epaper-rendering";
import type { DailyBriefWeatherModel } from "../src/generation";
import {
  type DashboardViewName,
  validateRenderedPage
} from "../src/render-validation";

interface Arguments {
  output: string;
  now: string;
  chrome?: string;
  dailyHtml?: string;
  calendarHtml?: string;
  validateImage?: string;
  view?: DashboardViewName;
}

const FONT_STRATEGY = "sans-serif";
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
];

function parseArguments(values: string[]): Arguments {
  const parsed: Arguments = {
    output: resolve("artifacts/renderer-previews", new Date().toISOString().replaceAll(":", "-")),
    now: new Date().toISOString()
  };
  const valueOptions = new Map<string, keyof Arguments>([
    ["--output", "output"],
    ["--now", "now"],
    ["--chrome", "chrome"],
    ["--daily-html", "dailyHtml"],
    ["--calendar-html", "calendarHtml"],
    ["--validate-image", "validateImage"],
    ["--view", "view"]
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const key = valueOptions.get(values[index]);
    if (!key || !values[index + 1]) {
      throw new Error(`Unknown or incomplete preview option: ${values[index]}`);
    }
    parsed[key] = values[index + 1] as never;
    index += 1;
  }
  parsed.output = resolve(parsed.output);
  return parsed;
}

function findChrome(configured?: string): string {
  const executable = [configured, ...CHROME_CANDIDATES].find(
    (candidate): candidate is string => Boolean(candidate && existsSync(candidate))
  );
  if (!executable) {
    throw new Error(
      "No local Chrome-family browser found; set CHROME_PATH or pass --chrome"
    );
  }
  return executable;
}

function previewModels(now: string): {
  daily: DailyBriefWeatherModel;
  calendar: CalendarViewModel;
} {
  const weather = {
    observedAt: now,
    current: { temperature: 68, condition: "Mostly clear" },
    today: {
      date: now.slice(0, 10),
      condition: "Partly cloudy",
      high: 75,
      low: 55,
      precipitationProbability: 10
    },
    tomorrow: {
      date: now.slice(0, 10),
      condition: "Light rain",
      high: 64,
      low: 51,
      precipitationProbability: 70
    }
  };
  const calendar = [
    {
      occurrenceId: "school-pickup",
      title: "School pickup",
      start: "2026-10-07T22:30:00.000Z",
      end: "2026-10-07T23:00:00.000Z",
      allDay: false,
      tentative: false,
      private: false,
      ownerLabels: ["Dad"],
      location: "Front entrance"
    },
    {
      occurrenceId: "piano-lesson",
      title: "Piano lesson",
      start: "2026-10-08T00:30:00.000Z",
      end: "2026-10-08T01:15:00.000Z",
      allDay: false,
      tentative: false,
      private: false,
      ownerLabels: ["Mom"],
      location: "Music studio"
    },
    {
      occurrenceId: "family-dinner",
      title: "Family dinner",
      start: "2026-10-08T02:00:00.000Z",
      end: "2026-10-08T03:00:00.000Z",
      allDay: false,
      tentative: false,
      private: false,
      ownerLabels: ["Mom", "Dad"]
    }
  ];
  const timezone = "America/Los_Angeles";
  return {
    daily: {
      weather,
      calendar,
      stale: false,
      timezone,
      updatedAt: now
    },
    calendar: {
      calendar,
      timezone,
      weather: { today: weather.today, tomorrow: weather.tomorrow },
      updatedAt: now
    }
  };
}

function assertPreviewPng(view: DashboardViewName, image: Uint8Array): void {
  const png = PNG.sync.read(Buffer.from(image));
  if (
    png.width !== DEVICE_LIMITS.imageWidth ||
    png.height !== DEVICE_LIMITS.imageHeight
  ) {
    throw new Error(
      `${view} preview image must be ${DEVICE_LIMITS.imageWidth}x${DEVICE_LIMITS.imageHeight}`
    );
  }
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    const alpha = png.data[offset + 3];
    if (
      alpha !== 255 ||
      red !== green ||
      green !== blue ||
      (red !== 0 && red !== 255)
    ) {
      throw new Error(`${view} preview image must use only opaque black and white`);
    }
  }
}

async function renderView(
  browser: Browser,
  view: DashboardViewName,
  html: string
): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    await configureEpaperViewport(page as never);
    await page.setContent(html, { waitUntil: "networkidle0" });
    await validateRenderedPage(page as never, view);
    const image = await captureEpaperPng(page as never);
    assertPreviewPng(view, image);
    return image;
  } finally {
    await page.close();
  }
}

async function renderPreviews(args: Arguments): Promise<void> {
  const models = previewModels(args.now);
  const views: Array<{
    label: DashboardViewName;
    filename: string;
    html: string;
  }> = [
    {
      label: "Daily Brief",
      filename: "daily-brief.png",
      html: args.dailyHtml
        ? readFileSync(resolve(args.dailyHtml), "utf8")
        : dailyBriefHtml(models.daily)
    },
    {
      label: "Calendar View",
      filename: "calendar-view.png",
      html: args.calendarHtml
        ? readFileSync(resolve(args.calendarHtml), "utf8")
        : calendarViewHtml(models.calendar)
    }
  ];
  const browser = await puppeteer.launch({
    executablePath: findChrome(args.chrome),
    headless: true,
    args: ["--disable-gpu", "--hide-scrollbars", "--no-sandbox"]
  });
  try {
    mkdirSync(args.output, { recursive: true });
    const rendered = [];
    for (const view of views) {
      const image = await renderView(browser, view.label, view.html);
      writeFileSync(resolve(args.output, view.filename), image);
      rendered.push({ label: view.label, filename: view.filename });
      console.log(`${view.label}: ${resolve(args.output, view.filename)}`);
    }
    writeFileSync(
      resolve(args.output, "preview-manifest.json"),
      `${JSON.stringify(
        {
          artifactKind: "local-renderer-preview",
          generatedAt: args.now,
          capture: {
            width: DEVICE_LIMITS.imageWidth,
            height: DEVICE_LIMITS.imageHeight,
            scale: 1,
            threshold: EPAPER_MONOCHROME_THRESHOLD,
            fontStrategy: FONT_STRATEGY,
            minimumTextPixels: DEVICE_LIMITS.minimumVisibleTextPixels
          },
          views: rendered,
          acceptanceEvidence: false
        },
        null,
        2
      )}\n`
    );
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  if (args.validateImage) {
    const view = args.view ?? "Daily Brief";
    const image = readFileSync(resolve(args.validateImage));
    assertPreviewPng(view, image);
    console.log(`${view}: ${basename(args.validateImage)} is a valid preview image`);
    return;
  }
  await renderPreviews(args);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

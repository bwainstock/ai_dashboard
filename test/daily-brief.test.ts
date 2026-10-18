import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import type { CalendarEvent } from "../src/calendar";
import { dailyBriefHtml } from "../src/daily-brief";
import type { DailyBriefWeatherModel } from "../src/generation";

const chromeExecutable = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].find((candidate): candidate is string =>
  Boolean(candidate && existsSync(candidate))
);

function event(
  title: string,
  start: string,
  values: Partial<CalendarEvent> = {}
): CalendarEvent {
  return {
    occurrenceId: `${title}|${start}`,
    title,
    start,
    end: start,
    allDay: false,
    tentative: false,
    private: false,
    ownerLabels: ["Mom"],
    ...values
  };
}

function model(
  values: Partial<DailyBriefWeatherModel> = {}
): DailyBriefWeatherModel {
  return {
    weather: {
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
    },
    calendar: [
      event("School pickup", "2026-10-07T20:30:00.000Z", {
        ownerLabels: ["Dad"],
        location: "Front entrance"
      }),
      event("Piano lesson", "2026-10-07T22:45:00.000Z"),
      event("Family dinner", "2026-10-08T01:00:00.000Z", {
        ownerLabels: ["Mom", "Dad"]
      }),
      event("Call grandparents", "2026-10-08T02:30:00.000Z"),
      event("Dentist", "2026-10-08T15:00:00.000Z"),
      event("Soccer practice", "2026-10-08T22:30:00.000Z"),
      event("Seventh event", "2026-10-09T01:00:00.000Z")
    ],
    stale: false,
    timezone: "America/Los_Angeles",
    updatedAt: "2026-10-07T17:30:00.000Z",
    ...values
  };
}

describe("Daily Brief", () => {
  test("fills the display with dated forecasts and six calendar entries", () => {
    const html = dailyBriefHtml(model());

    expect(html).toContain("Wednesday");
    expect(html).toContain("October 7");
    expect(html).toContain("Today at a glance");
    expect(html).toContain("75° / 55°");
    expect(html).toContain("Partly cloudy · Rain 10%");
    expect(html).toContain("64° / 51°");
    expect(html).toContain("Rain · Rain 70%");
    expect(html).toContain("School pickup");
    expect(html).toContain("Soccer practice");
    expect(html).not.toContain("Seventh event");
    expect(html).not.toContain("Front entrance");
    expect(html).toContain("Updated 10:30 AM");
  });

  test("limits Calendar Feed entries to today and tomorrow", () => {
    const html = dailyBriefHtml(
      model({
        calendar: [
          event("Tomorrow", "2026-10-08T20:00:00.000Z"),
          event("Third day", "2026-10-09T20:00:00.000Z")
        ]
      })
    );

    expect(html).toContain("Tomorrow");
    expect(html).not.toContain("Third day");
  });

  test("never presents live-looking weather or clock details", () => {
    const html = dailyBriefHtml(model());

    expect(html).not.toContain("68°");
    expect(html).not.toContain("Mostly clear");
    expect(html).not.toMatch(/\b(current|live|right now|now)\b/i);
    expect(html).not.toMatch(/class="[^"]*clock/);
  });

  test("shows source-specific stale ages with one update timestamp", () => {
    const html = dailyBriefHtml(
      model({
        stale: true,
        staleAgeMinutes: 125,
        calendarStaleAgeMinutes: 45
      })
    );

    expect(html).toContain("Weather 2h 5m old");
    expect(html).toContain("Calendar 45m old");
    expect(html.match(/Updated 10:30 AM/g)).toHaveLength(1);
  });

  test.each([
    [{ calendar: [] }, "No events today or tomorrow"],
    [{ calendar: [], calendarUnavailable: true }, "Calendar unavailable"]
  ])("renders a readable calendar missing state", (values, text) => {
    const html = dailyBriefHtml(model(values));

    expect(html).toContain(text);
    expect(html).toContain("data-missing-state");
  });

  test.skipIf(!chromeExecutable)(
    "keeps tomorrow event labels within the 800x480 render",
    () => {
      let html = dailyBriefHtml(
        model({
          updatedAt: "2026-10-16T14:00:00.000Z",
          calendar: [
            event("First tomorrow event", "2026-10-17T16:00:00.000Z"),
            event("Second tomorrow event", "2026-10-17T18:00:00.000Z")
          ]
        })
      );
      html = html.replaceAll(
        '"Arial Narrow", Arial, Helvetica, sans-serif',
        "Arial, Helvetica, sans-serif"
      );
      html = html.replace(
        "</body>",
        `<script>
          const overflowing = Array.from(document.body.querySelectorAll("*"))
            .filter((element) => {
              const bounds = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const clipsHorizontally = ["hidden", "clip"].includes(style.overflowX);
              const clipsVertically = ["hidden", "clip"].includes(style.overflowY);
              return bounds.left < 0 || bounds.top < 0 ||
                bounds.right > 800 || bounds.bottom > 480 ||
                (!clipsHorizontally && element.scrollWidth > element.clientWidth) ||
                (!clipsVertically &&
                  element.scrollHeight - element.clientHeight > 4);
            });
          document.title = JSON.stringify(
            overflowing.map((element) => element.tagName)
          );
        </script></body>`
      );

      const rendered = execFileSync(
        chromeExecutable!,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--hide-scrollbars",
          "--window-size=800,567",
          "--dump-dom",
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const overflowing = JSON.parse(
        rendered.match(/<title>(.*?)<\/title>/s)?.[1] ?? "null"
      ) as string[];

      expect(overflowing).toEqual([]);
    },
    45_000
  );
});

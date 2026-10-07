import { describe, expect, test } from "vitest";
import { lunchViewModel, lunchViewHtml } from "../src/lunch-view";
import type { LunchSnapshot } from "../src/lunch";

const WEEK: LunchSnapshot = {
  days: [
    { date: "2026-10-05", status: "menu", entrees: ["Cheese Pizza"] },
    { date: "2026-10-06", status: "closed", entrees: [] },
    { date: "2026-10-07", status: "menu", entrees: ["Bean Burrito"] },
    { date: "2026-10-08", status: "menu", entrees: [] },
    { date: "2026-10-09", status: "menu", entrees: ["Chicken Tenders"] }
  ]
};

const classifier = {
  loadCached: async () => null,
  saveCached: async () => undefined
};

describe("Lunch View", () => {
  test("shows the current Monday-through-Friday school week with entree icons and text", async () => {
    const model = await lunchViewModel(
      WEEK,
      new Date("2026-10-07T17:30:00.000Z"),
      "America/Los_Angeles",
      null,
      classifier
    );
    const html = lunchViewHtml(model);

    expect(model.week).toBe("current");
    expect(model.days.map(({ date }) => date)).toEqual([
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09"
    ]);
    expect(html).toContain("Lunch View");
    expect(html).toContain("Cheese Pizza");
    expect(html).toContain('aria-label="pizza lunch icon"');
    expect(html).toContain("School closed");
    expect(html).toContain("No menu posted");
    expect(html).not.toMatch(/breakfast|nutrition|allergen/i);
  });

  test("switches to the upcoming school week on weekends", async () => {
    const upcoming: LunchSnapshot = {
      days: [
        {
          date: "2026-10-12",
          status: "menu",
          entrees: ["Turkey Sandwich"]
        }
      ]
    };

    const model = await lunchViewModel(
      upcoming,
      new Date("2026-10-10T19:00:00.000Z"),
      "America/Los_Angeles",
      null,
      classifier
    );

    expect(model.week).toBe("upcoming");
    expect(model.days[0]).toMatchObject({
      date: "2026-10-12",
      entrees: [{ name: "Turkey Sandwich", icon: "sandwich" }]
    });
    expect(lunchViewHtml(model)).toContain("Upcoming school week");
  });

  test("states explicitly when the upcoming menu is unavailable", async () => {
    const model = await lunchViewModel(
      { days: [] },
      new Date("2026-10-10T19:00:00.000Z"),
      "America/Los_Angeles",
      null,
      classifier
    );
    const html = lunchViewHtml(model);

    expect(model.status).toBe("upcoming_unavailable");
    expect(html).toContain('aria-label="Lunch icon"');
    expect(html).toContain("Next week's menu not posted");
    expect(html).not.toContain("School closed");
  });

  test("shows the retained menu age independently from the generation update time", async () => {
    const model = await lunchViewModel(
      WEEK,
      new Date("2026-10-07T17:30:00.000Z"),
      "America/Los_Angeles",
      "adapter_failure",
      classifier,
      75
    );
    const html = lunchViewHtml(model);

    expect(html).toContain("Menu 1h 15m old");
    expect(html.match(/Updated 10:30 AM/g)).toHaveLength(1);
  });
});

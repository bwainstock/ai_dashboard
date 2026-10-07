import { expect, test } from "vitest";
import { dailyBriefHtml } from "../src/daily-brief";

test("Daily Brief presents current, today, and tomorrow weather with icons and text", () => {
  const html = dailyBriefHtml({
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
    stale: false,
    lunch: {
      status: "available",
      stale: false,
      entrees: [
        { name: "Cheese Pizza", icon: "pizza" },
        { name: "Vegetable Yakisoba", icon: "generic" }
      ]
    },
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain('aria-label="Mostly clear weather icon"');
  expect(html).toContain("68°F");
  expect(html).toContain("Mostly clear");
  expect(html).toContain("Partly cloudy");
  expect(html).toContain("High 75° · Low 55° · Rain 10%");
  expect(html).toContain("Rain");
  expect(html).toContain("High 64° · Low 51° · Rain 70%");
  expect(html).toContain('aria-label="pizza lunch icon"');
  expect(html).toContain("Cheese Pizza");
  expect(html).toContain('aria-label="generic lunch icon"');
  expect(html).toContain("Vegetable Yakisoba");
  expect(html).toContain("Updated 10:30 AM");
});

test.each([
  ["no_menu", "No menu posted"],
  ["closed", "School closed"],
  ["schema_failure", "Lunch source changed"],
  ["adapter_failure", "Lunch unavailable"]
] as const)("Daily Brief renders %s as %s", (status, visibleText) => {
  const html = dailyBriefHtml({
    weather: {
      observedAt: "2026-10-07T10:25",
      current: { temperature: 68, condition: "Clear" },
      today: {
        date: "2026-10-07",
        condition: "Clear",
        high: 75,
        low: 55,
        precipitationProbability: 0
      },
      tomorrow: {
        date: "2026-10-08",
        condition: "Clear",
        high: 76,
        low: 56,
        precipitationProbability: 0
      }
    },
    stale: false,
    lunch: { status, stale: status.includes("failure"), entrees: [] },
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain(visibleText);
});

test("failure states label retained normalized entrees as the last menu", () => {
  const html = dailyBriefHtml({
    weather: {
      observedAt: "2026-10-07T10:25",
      current: { temperature: 68, condition: "Clear" },
      today: {
        date: "2026-10-07",
        condition: "Clear",
        high: 75,
        low: 55,
        precipitationProbability: 0
      },
      tomorrow: {
        date: "2026-10-08",
        condition: "Clear",
        high: 76,
        low: 56,
        precipitationProbability: 0
      }
    },
    stale: false,
    lunch: {
      status: "adapter_failure",
      stale: true,
      entrees: [{ name: "Bean Burrito", icon: "taco" }]
    },
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain("Lunch unavailable");
  expect(html).toContain("Last menu");
  expect(html).toContain("Bean Burrito");
  expect(html).not.toMatch(/breakfast|nutrition|allergen/i);
});

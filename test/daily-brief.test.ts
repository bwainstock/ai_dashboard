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
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain('aria-label="Mostly clear weather icon"');
  expect(html).toContain("68°F");
  expect(html).toContain("Mostly clear");
  expect(html).toContain("Partly cloudy");
  expect(html).toContain("High 75° · Low 55° · Rain 10%");
  expect(html).toContain("Rain");
  expect(html).toContain("High 64° · Low 51° · Rain 70%");
  expect(html).toContain("Updated 10:30 AM");
});

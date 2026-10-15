import { expect, test } from "vitest";
import { dailyBriefHtml } from "../src/daily-brief";

test("Daily Brief presents the date, daily forecast, and upcoming events without live-style data", () => {
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
    calendar: [
      {
        occurrenceId: "school|2026-10-07",
        title: "School holiday",
        start: "2026-10-07",
        end: "2026-10-08",
        allDay: true,
        tentative: false,
        private: false,
        ownerLabels: ["Mom", "Dad"]
      },
      {
        occurrenceId: "dentist|2026-10-08T00:00:00.000Z",
        title: "Dentist",
        start: "2026-10-08T00:00:00.000Z",
        end: "2026-10-08T01:00:00.000Z",
        allDay: false,
        tentative: true,
        private: false,
        ownerLabels: ["Mom"],
        location: "123 Main Street"
      }
    ],
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

  expect(html).toContain("Wednesday");
  expect(html).toContain("October 7");
  expect(html).toContain('aria-label="Partly cloudy weather icon"');
  expect(html).not.toContain("68°F");
  expect(html).not.toContain("Mostly clear");
  expect(html).toContain("Partly cloudy");
  expect(html).toContain("High 75° · Low 55° · Rain 10%");
  expect(html).toContain("Rain");
  expect(html).toContain("High 64° · Low 51° · Rain 70%");
  expect(html).toContain('aria-label="pizza lunch icon"');
  expect(html).toContain("Cheese Pizza");
  expect(html).toContain('aria-label="generic lunch icon"');
  expect(html).toContain("Vegetable Yakisoba");
  expect(html).toContain("School holiday");
  expect(html).toContain("All day");
  expect(html).toContain("Dentist");
  expect(html).toContain("Tentative");
  expect(html).toContain("Mom");
  expect(html).not.toContain("123 Main Street");
  expect(html).not.toContain("Next up");
  expect(html).not.toContain("until start");
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
  expect(html).toContain("data-missing-state");
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

test("stale sections show their own ages while retaining one global update time", () => {
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
    calendar: [],
    stale: true,
    staleAgeMinutes: 125,
    calendarStaleAgeMinutes: 45,
    lunch: {
      status: "adapter_failure",
      stale: true,
      staleAgeMinutes: 90,
      entrees: [{ name: "Bean Burrito", icon: "taco" }]
    },
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain("Weather 2h 5m old");
  expect(html).toContain("Calendar 45m old");
  expect(html).toContain("Last menu · 1h 30m old");
  expect(html.match(/Updated 10:30 AM/g)).toHaveLength(1);
});

test("Daily Brief shows only the next three events with equal presentation", () => {
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
    calendar: [
      {
        occurrenceId: "practice|2026-10-07T19:00:00.000Z",
        title: "Practice",
        start: "2026-10-07T19:00:00.000Z",
        end: "2026-10-07T20:00:00.000Z",
        allDay: false,
        tentative: false,
        private: false,
        ownerLabels: ["Dad"]
      },
      {
        occurrenceId: "dentist|2026-10-07T20:00:00.000Z",
        title: "Dentist",
        start: "2026-10-07T20:00:00.000Z",
        end: "2026-10-07T21:00:00.000Z",
        allDay: false,
        tentative: false,
        private: false,
        ownerLabels: ["Mom"]
      },
      {
        occurrenceId: "dinner|2026-10-07T22:00:00.000Z",
        title: "Family dinner",
        start: "2026-10-07T22:00:00.000Z",
        end: "2026-10-07T23:00:00.000Z",
        allDay: false,
        tentative: false,
        private: false,
        ownerLabels: ["Mom", "Dad"]
      },
      {
        occurrenceId: "later|2026-10-08T01:00:00.000Z",
        title: "Fourth event",
        start: "2026-10-08T01:00:00.000Z",
        end: "2026-10-08T02:00:00.000Z",
        allDay: false,
        tentative: false,
        private: false,
        ownerLabels: ["Dad"]
      }
    ],
    stale: false,
    lunch: { status: "available", stale: false, entrees: [] },
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain("Upcoming events");
  expect(html).toContain("Practice");
  expect(html).toContain("Dentist");
  expect(html).toContain("Family dinner");
  expect(html).not.toContain("Fourth event");
  expect(html).not.toContain("Next up");
  expect(html).not.toContain("until start");
});

test("Daily Brief publishes the highest-priority notice using only approved fields", () => {
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
    lunch: { status: "available", stale: false, entrees: [] },
    notices: [
      {
        category: "school",
        summary: "Field trip permission form is due.",
        relevantDate: "Oct 10",
        action: "Return the permission form.",
        senderOrganization: "School"
      },
      {
        category: "childcare",
        summary: "Childcare closes early Friday.",
        relevantDate: "Oct 9",
        action: null,
        senderOrganization: "Childcare"
      },
      {
        category: "school",
        summary: "This third notice must not render.",
        relevantDate: null,
        action: null,
        senderOrganization: "School"
      }
    ],
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain("Field trip permission form is due.");
  expect(html).not.toContain("Childcare closes early Friday.");
  expect(html).not.toContain("This third notice must not render.");
  for (const forbidden of [
    "teacher@school.example",
    "raw-message-id",
    "confidence",
    "RAW SUBJECT TOKEN",
    "RAW BODY TOKEN"
  ]) {
    expect(html).not.toContain(forbidden);
  }
});

test("sensitive mail renders only account-specific Private Notice Markers", () => {
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
    lunch: { status: "available", stale: false, entrees: [] },
    privateNoticeMarkers: [{ accountId: "mom" }, { accountId: "dad" }],
    updatedAt: "2026-10-07T17:30:00.000Z"
  });

  expect(html).toContain("Mom Private Notice");
  expect(html).toContain("Dad Private Notice");
  expect(html).not.toMatch(/appointment|sender|category|2026-10-13/i);
});

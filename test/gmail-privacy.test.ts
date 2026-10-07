import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import fixture from "./fixtures/gmail/school-notice.json";
import { dailyBriefHtml } from "../src/daily-brief";

describe("Gmail privacy inspection", () => {
  test("dedicated Worker disables observability and contains no logging calls", async () => {
    const [configuration, worker] = await Promise.all([
      readFile("wrangler.gmail.toml", "utf8"),
      readFile("src/gmail-worker.ts", "utf8")
    ]);

    expect(configuration).toMatch(/\[observability\]\s+enabled = false/);
    expect(configuration).not.toMatch(/gateway/i);
    expect(worker).not.toMatch(/\bconsole\.|\blog\(/);
  });

  test("retained schema has only hashes and validated notice fields", async () => {
    const migration = await readFile(
      "migrations/0010_gmail_notices.sql",
      "utf8"
    );

    for (const forbiddenColumn of [
      "message_id",
      "thread_id",
      "subject",
      "body",
      "sender_address",
      "prompt",
      "model_output",
      "raw_output"
    ]) {
      expect(migration).not.toMatch(
        new RegExp(`\\b${forbiddenColumn}\\b`, "i")
      );
    }
    expect(migration).toContain("source_key");
    expect(migration).toContain("CHECK (length(source_key) = 64)");
  });

  test("delivery HTML contains approved fields, not fixture raw Gmail data", () => {
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
          category: fixture.extraction.category as "school",
          summary: fixture.extraction.summary,
          relevantDate: fixture.extraction.relevantDate,
          action: fixture.extraction.action,
          senderOrganization: fixture.extraction.senderOrganization
        }
      ],
      updatedAt: "2026-10-07T17:30:00.000Z"
    });
    const raw = fixture.candidate;

    expect(html).toContain(fixture.extraction.summary);
    for (const forbidden of [
      raw.messageId,
      raw.threadId,
      raw.from,
      raw.subject,
      raw.body
    ]) {
      expect(html).not.toContain(forbidden);
    }
  });
});

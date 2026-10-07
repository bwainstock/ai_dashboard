import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import fixture from "./fixtures/gmail/school-notice.json";
import { dailyBriefHtml } from "../src/daily-brief";
import { noticesViewHtml } from "../src/notices-view";
import { operationalIncidentEmail } from "../src/incidents";

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
    const migration = (
      await Promise.all([
        readFile("migrations/0010_gmail_notices.sql", "utf8"),
          readFile("migrations/0011_protected_gmail_review.sql", "utf8"),
          readFile("migrations/0013_gmail_controls.sql", "utf8")
      ])
    ).join("\n");

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
    expect(migration).toContain("gmail_protected_reviews");
    expect(migration).not.toMatch(/\braw_(?:subject|body|content)\b/i);
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

  test("final storage and delivery surfaces contain fixed metadata and no forbidden raw Gmail fixture data", async () => {
    const [deviceWorker, gmailWorker, incidents, migrations, configuration] =
      await Promise.all([
        readFile("src/index.ts", "utf8"),
        readFile("src/gmail-worker.ts", "utf8"),
        readFile("src/incidents.ts", "utf8"),
        Promise.all(
          [
            "0010_gmail_notices.sql",
            "0011_protected_gmail_review.sql",
            "0012_notices_view.sql",
            "0013_gmail_controls.sql"
          ].map((name) => readFile(`migrations/${name}`, "utf8"))
        ).then((files) => files.join("\n")),
        readFile("wrangler.gmail.toml", "utf8")
      ]);
    const noticesHtml = noticesViewHtml({
      notices: [
        {
          category: "school",
          summary: fixture.extraction.summary,
          relevantDate: fixture.extraction.relevantDate,
          action: fixture.extraction.action,
          senderOrganization: fixture.extraction.senderOrganization
        }
      ],
      privateNoticeMarkers: [],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T18:00:00.000Z"
    });
    const incident = JSON.stringify(
      operationalIncidentEmail(
        "GMAIL_PROCESSING_REPEATED_FAILURE",
        "dashboard@example.com",
        "operator@example.com"
      )
    );
    const raw = fixture.candidate;

    expect(deviceWorker).toMatch(
      /customMetadata: \{ width: "800", height: "480", palette: "monochrome" \}/
    );
    expect(deviceWorker).toMatch(
      /\/images\/\$\{encodeURIComponent\(generation\.filename\)\}/
    );
    expect(incidents).toContain("GMAIL_PROCESSING_REPEATED_FAILURE");
    expect(configuration).toMatch(/\[observability\]\s+enabled = false/);
    expect(gmailWorker).not.toMatch(/\bconsole\.|\blog\(/);
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
      expect(migrations).not.toMatch(
        new RegExp(`\\b${forbiddenColumn}\\b`, "i")
      );
    }
    for (const forbidden of [
      raw.messageId,
      raw.threadId,
      raw.from,
      raw.subject,
      raw.body
    ]) {
      expect(noticesHtml).not.toContain(forbidden);
      expect(incident).not.toContain(forbidden);
      expect(deviceWorker).not.toContain(forbidden);
      expect(gmailWorker).not.toContain(forbidden);
    }
  });
});

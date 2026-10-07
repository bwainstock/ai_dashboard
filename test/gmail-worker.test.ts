import { describe, expect, test } from "vitest";
import {
  recordGmailProcessingFailure,
  recordGmailProcessingRecovery,
  runGmailRetentionMaintenance
} from "../src/gmail-worker";

class RecordingDatabase {
  readonly statements: Array<{ query: string; parameters: unknown[] }> = [];

  prepare(query: string) {
    let parameters: unknown[] = [];
    const statement = {
      bind: (...values: unknown[]) => {
        parameters = values;
        return statement;
      },
      run: async () => {
        this.statements.push({ query, parameters });
        return { success: true, meta: { changes: 1 } };
      }
    };
    return statement;
  }
}

describe("Gmail scheduled maintenance", () => {
  test("purges all bounded-retention tables even when no account is connected", async () => {
    const database = new RecordingDatabase();
    await runGmailRetentionMaintenance(
      database as unknown as D1Database,
      new Date("2026-11-07T18:00:00.000Z")
    );

    expect(database.statements.map(({ query }) => query)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("DELETE FROM household_notices"),
        expect.stringContaining("DELETE FROM gmail_protected_reviews"),
        expect.stringContaining("DELETE FROM gmail_review_records")
      ])
    );
    expect(
      database.statements.every(({ parameters }) =>
        parameters.includes("2026-11-07T18:00:00.000Z")
      )
    ).toBe(true);
  });

  test("fixed-code failure increments Gmail state and recovery clears failure and quota", async () => {
    const database = new RecordingDatabase();
    await recordGmailProcessingFailure(
      database as unknown as D1Database,
      "GMAIL_PROCESSING_FAILED"
    );
    await recordGmailProcessingRecovery(
      database as unknown as D1Database,
      new Date("2026-10-07T18:00:00.000Z")
    );

    const serialized = JSON.stringify(database.statements);
    expect(serialized).toContain("consecutive_failures = consecutive_failures + 1");
    expect(serialized).toContain("GMAIL_PROCESSING_FAILED");
    expect(serialized).toContain("consecutive_failures = 0");
    expect(serialized).toContain("status_value = 'available'");
    expect(serialized).not.toMatch(/subject|sender|message|prompt|response|body/i);
  });
});

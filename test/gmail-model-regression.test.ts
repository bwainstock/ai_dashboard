import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import {
  runGmailModelRegression,
  type GmailRegressionFixture
} from "../src/gmail-model-regression";

const fixtureNames = [
  "accepted",
  "prompt-injection",
  "malformed-output",
  "low-confidence",
  "safety",
  "quota",
  "invalid-date"
];

async function fixture(name: string): Promise<GmailRegressionFixture> {
  return JSON.parse(
    await readFile(`test/fixtures/gmail/regression/${name}.json`, "utf8")
  ) as GmailRegressionFixture;
}

describe("Gmail model promotion regression gate", () => {
  test("the synthetic suite covers every required fail-closed class", async () => {
    const fixtures = await Promise.all(fixtureNames.map(fixture));
    expect(fixtures.map(({ name }) => name).sort()).toEqual(
      fixtureNames.sort()
    );
    expect(JSON.stringify(fixtures)).not.toMatch(
      /gmail\.com|message-id|real child|raw subject/i
    );
    expect(
      fixtures.every(({ candidate }) =>
        candidate.from.endsWith("@synthetic-school.example")
      )
    ).toBe(true);
  });

  test("a candidate model is promotable only when every synthetic fixture passes", async () => {
    const fixtures = await Promise.all(fixtureNames.map(fixture));
    const runAi = vi.fn(async (_modelId: string, current: GmailRegressionFixture) => {
      if (current.name === "quota") {
        throw Object.assign(new Error("synthetic quota"), { status: 429 });
      }
      return current.modelOutput;
    });

    await expect(
      runGmailModelRegression(
        {
          modelId: "@cf/example/candidate",
          modelVersion: "2026-10-07"
        },
        fixtures,
        runAi
      )
    ).resolves.toEqual({
      modelId: "@cf/example/candidate",
      modelVersion: "2026-10-07",
      passed: fixtureNames.length
    });

    const broken = fixtures.map((current) =>
      current.name === "accepted"
        ? { ...current, modelOutput: "{malformed" }
        : current
    );
    await expect(
      runGmailModelRegression(
        { modelId: "@cf/example/broken", modelVersion: "candidate" },
        broken,
        runAi
      )
    ).rejects.toThrow(/accepted/);
  });
});

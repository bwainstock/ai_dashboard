import { processGmailCandidate, type GmailCandidate } from "./gmail";

export type GmailRegressionExpectation =
  | "accepted"
  | "protected"
  | "rejected"
  | "quota";

export interface GmailRegressionFixture {
  name: string;
  candidate: Omit<GmailCandidate, "messageId" | "threadId">;
  modelOutput: unknown;
  expected: GmailRegressionExpectation;
}

export async function runGmailModelRegression(
  candidateModel: { modelId: string; modelVersion: string },
  fixtures: GmailRegressionFixture[],
  runAi: (
    modelId: string,
    fixture: GmailRegressionFixture,
    input: unknown
  ) => Promise<unknown>
): Promise<{ modelId: string; modelVersion: string; passed: number }> {
  for (const fixture of fixtures) {
    let actual: GmailRegressionExpectation;
    try {
      const result = await processGmailCandidate(
        {
          ...fixture.candidate,
          messageId: `synthetic-${fixture.name}`,
          threadId: `synthetic-thread-${fixture.name}`
        },
        {
          now: new Date("2026-10-07T18:00:00.000Z"),
          accountId: "mom",
          allowedSenderDomains: ["synthetic-school.example"],
          modelId: candidateModel.modelId,
          async runAi(input) {
            const output = await runAi(candidateModel.modelId, fixture, input);
            return {
              response: output,
              modelVersion: candidateModel.modelVersion
            };
          },
          async saveValidated() {},
          async saveProtected() {}
        }
      );
      actual =
        result.status === "filtered" ? "rejected" : result.status;
    } catch (error) {
      if (
        error !== null &&
        typeof error === "object" &&
        "status" in error &&
        error.status === 429
      ) {
        actual = "quota";
      } else {
        throw error;
      }
    }
    if (actual !== fixture.expected) {
      throw new Error(
        `Gmail model regression failed: ${fixture.name} expected ${fixture.expected}, received ${actual}`
      );
    }
  }
  return {
    modelId: candidateModel.modelId,
    modelVersion: candidateModel.modelVersion,
    passed: fixtures.length
  };
}

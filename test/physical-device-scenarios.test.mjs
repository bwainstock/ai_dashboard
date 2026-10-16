import { describe, expect, test } from "vitest";
import { createPendingReport } from "../scripts/device-acceptance-lib.mjs";
import {
  HUMAN_OBSERVATIONS,
  acceptanceEvidencePath,
  assertSanitizedReport,
  buildSuccessfulIssueSummary,
  physicalAcceptanceStatus,
  postSuccessfulIssueSummary,
  runGuidedObservations
} from "../scripts/physical-device-scenarios-lib.mjs";

const AUTOMATED_PASS = {
  status: "pass",
  checks: [{ name: "production device acceptance", status: "pass" }],
  artifacts: [
    { filename: "daily-brief-generation.png" },
    { filename: "calendar-view-generation.png" }
  ]
};

function pendingReport() {
  return createPendingReport({
    runId: "physical-device-2026-10-16",
    baseUrl: "https://device.example.com",
    firmwareVersion: "sha256:abc123",
    panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
    automated: AUTOMATED_PASS
  });
}

describe("guided physical device scenarios", () => {
  test("starts every judgment-dependent physical scenario explicitly pending", () => {
    const report = pendingReport();

    expect(Object.keys(report.hardware.observations)).toEqual(
      HUMAN_OBSERVATIONS.map(({ name }) => name)
    );
    expect(
      Object.values(report.hardware.observations).every(
        ({ status, observedAt, notes }) =>
          status === "pending" && observedAt === null && notes === ""
      )
    ).toBe(true);
    expect(physicalAcceptanceStatus(report)).toBe("pending");
  });

  test("records a human-entered failure timestamp and note while deferred scenarios remain pending", async () => {
    const answers = [
      "fail",
      "2026-10-16T21:15:00-07:00",
      "Calendar View did not appear after one Key 3 press.",
      ...HUMAN_OBSERVATIONS.slice(1).map(() => "pending")
    ];
    const prompts = [];
    const report = pendingReport();

    await runGuidedObservations(report, {
      isHumanInteractive: true,
      ask: async (prompt) => {
        prompts.push(prompt);
        return answers.shift();
      }
    });

    expect(report.hardware.observations.offlineOnePressNavigation).toEqual({
      status: "fail",
      observedAt: "2026-10-16T21:15:00-07:00",
      notes: "Calendar View did not appear after one Key 3 press."
    });
    expect(physicalAcceptanceStatus(report)).toBe("fail");
    expect(prompts.join("\n")).toContain("Wi-Fi unavailable");
    expect(prompts.join("\n")).toContain("previous complete pair");
    expect(prompts.join("\n")).toContain("no image-body download");
  });

  test("does not accept observation transitions from a non-interactive process", async () => {
    const report = pendingReport();

    await expect(
      runGuidedObservations(report, {
        isHumanInteractive: false,
        ask: async () => "pass"
      })
    ).rejects.toThrow("interactive human terminal");
    expect(physicalAcceptanceStatus(report)).toBe("pending");
  });

  test("requires a real human-entered timestamp before recording a result", async () => {
    const report = pendingReport();
    const answers = ["fail", "", "Device stayed on Daily Brief."];

    await expect(
      runGuidedObservations(report, {
        isHumanInteractive: true,
        ask: async () => answers.shift()
      })
    ).rejects.toThrow("valid observed timestamp");
    expect(report.hardware.observations.offlineOnePressNavigation.status).toBe(
      "pending"
    );
  });
});

describe("durable physical acceptance evidence", () => {
  test("only accepts report paths under the predictable device evidence directory", () => {
    expect(
      acceptanceEvidencePath("evidence/device-acceptance/device-2026-10-16.json")
    ).toMatch(/evidence\/device-acceptance\/device-2026-10-16\.json$/);
    expect(() => acceptanceEvidencePath("physical.json")).toThrow(
      "evidence/device-acceptance"
    );
    expect(() =>
      acceptanceEvidencePath("evidence/device-acceptance/../private.json")
    ).toThrow("evidence/device-acceptance");
  });

  test("rejects credentials and raw device details before durable evidence is written", () => {
    const report = pendingReport();
    report.hardware.observations.offlineOnePressNavigation.notes =
      "Access-Token: top-secret";

    expect(() =>
      assertSanitizedReport(report, {
        sensitiveValues: ["top-secret", "raw-device-id", "Home Network"]
      })
    ).toThrow("sanitization");
  });

  test("builds a concise non-sensitive successful parent-issue summary", () => {
    const summary = buildSuccessfulIssueSummary({
      runId: "physical-device-2026-10-16",
      reportPath: "evidence/device-acceptance/device-2026-10-16.json",
      completedAt: "2026-10-16T22:30:00.000Z",
      firmwareIdentity: "sha256:abc123",
      generation: "generation-2026-10-16"
    });

    expect(summary).toContain("Physical acceptance passed");
    expect(summary).toContain(
      "`evidence/device-acceptance/device-2026-10-16.json`"
    );
    expect(summary).toContain("generation-2026-10-16");
    expect(summary).not.toMatch(
      /Access-Token|Authorization|DEVICE_TOKEN|Wi-Fi|SSID|household/i
    );
  });

  test("posts the successful summary to the parent issue through the mocked gh boundary", async () => {
    const commands = [];
    const result = await postSuccessfulIssueSummary(
      {
        runId: "physical-device-2026-10-16",
        reportPath: "evidence/device-acceptance/device-2026-10-16.json",
        completedAt: "2026-10-16T22:30:00.000Z",
        firmwareIdentity: "sha256:abc123",
        generation: "generation-2026-10-16"
      },
      {
        runCommand: async (...command) => {
          commands.push(command);
          return { exitCode: 0, output: "comment posted" };
        }
      }
    );

    expect(result).toEqual({ exitCode: 0, output: "comment posted" });
    expect(commands).toHaveLength(1);
    expect(commands[0].slice(0, 3)).toEqual(["gh", "issue", "comment"]);
    expect(commands[0]).toContain("38");
    expect(commands[0].join(" ")).not.toMatch(
      /Access-Token|Authorization|DEVICE_TOKEN|Wi-Fi|SSID|household/i
    );
  });
});

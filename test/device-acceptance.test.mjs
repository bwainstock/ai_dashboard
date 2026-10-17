import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  createPendingFourGrayPrototype,
  createPendingReport,
  validateDisplaySequence,
  validatePngArtifact,
  validateReport
} from "../scripts/device-acceptance-lib.mjs";

const ACCEPTANCE_SCHEMA_URL = new URL(
  "../docs/acceptance/device-acceptance-report.schema.json",
  import.meta.url
);

const AUTOMATED_PASS = {
  status: "pass",
  checks: [{ name: "privacy", status: "pass" }],
  artifacts: [
    { filename: "daily-brief-generation.png" },
    { filename: "calendar-view-generation.png" }
  ]
};

function png(width = 800, height = 480, color = 0) {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = color;
    image.data[offset + 1] = color;
    image.data[offset + 2] = color;
    image.data[offset + 3] = 255;
  }
  image.data[0] = 255;
  image.data[1] = 255;
  image.data[2] = 255;
  return PNG.sync.write(image);
}

function createPassingFourGrayReport() {
  const report = createPendingReport({
    runId: "passing-four-gray",
    baseUrl: "https://device.example.com",
    firmwareVersion: null,
    panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
    automated: AUTOMATED_PASS
  });
  report.fourGrayPrototype = createPendingFourGrayPrototype();
  Object.assign(report.fourGrayPrototype, {
    status: "pass",
    firmwareCommit: "cf145a72d835a5ef0b66576a5945bc7f16f232c0",
    refreshDurationMilliseconds: 12_345,
    psramHeadroomBeforeBytes: 1_000_000,
    psramHeadroomAfterBytes: 800_000,
    notes: "Prototype acceptance completed on the target panel."
  });
  for (const [name, observation] of Object.entries(
    report.fourGrayPrototype.observations
  )) {
    Object.assign(observation, {
      status: "pass",
      observedAt: "2026-10-17T08:30:00.000-07:00",
      notes: `Observed acceptable ${name}.`
    });
  }
  return report;
}

describe("device acceptance artifacts", () => {
  test("accepts a decodable monochrome 800x480 named PNG within tested limits", () => {
    expect(
      validatePngArtifact(
        png(),
        "daily-brief-20261007T173000Z.png",
        "daily-brief",
        1_000_000
      )
    ).toMatchObject({
      dimensions: "800x480",
      monochrome: true,
      nonBlank: true
    });
  });

  test.each([
    ["wrong dimensions", png(799, 480), "daily-brief-1.png"],
    ["wrong view name", png(), "calendar-view-1.png"],
    ["oversize", png(), "daily-brief-1.png", 10],
    ["non-1-bit grayscale", png(800, 480, 128), "daily-brief-1.png"]
  ])("rejects %s", (_label, bytes, filename, maximum = 1_000_000) => {
    expect(() =>
      validatePngArtifact(bytes, filename, "daily-brief", maximum)
    ).toThrow();
  });

  test("validates stable cache names, the two-view button cycle, and timer reset", () => {
    expect(
      validateDisplaySequence([
        "daily-brief-generation.png",
        "daily-brief-generation.png",
        "calendar-view-generation.png",
        "daily-brief-generation.png",
        "daily-brief-generation.png"
      ])
    ).toEqual({
      generation: "generation",
      cacheStable: true,
      buttonCycle: true,
      timerReset: true
    });
  });

  test("rejects a mixed-generation or incorrectly ordered display sequence", () => {
    expect(() =>
      validateDisplaySequence([
        "daily-brief-a.png",
        "daily-brief-a.png",
        "calendar-view-b.png",
        "daily-brief-a.png",
        "daily-brief-a.png"
      ])
    ).toThrow();
  });
});

describe("persistent acceptance report", () => {
  test("the canonical report optionally records pending four-gray prototype evidence", async () => {
    const schema = JSON.parse(await readFile(ACCEPTANCE_SCHEMA_URL, "utf8"));
    const report = createPendingReport({
      runId: "four-gray-prototype",
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.fourGrayPrototype = createPendingFourGrayPrototype();

    expect(schema.required).not.toContain("fourGrayPrototype");
    expect(schema.properties.fourGrayPrototype).toEqual({
      $ref: "#/$defs/fourGrayPrototype"
    });
    expect(validateReport(report)).toEqual([]);
    expect(report.fourGrayPrototype).toMatchObject({
      status: "pending",
      firmwareCommit: null,
      refreshDurationMilliseconds: null,
      psramHeadroomBeforeBytes: null,
      psramHeadroomAfterBytes: null
    });
    expect(
      Object.values(report.fourGrayPrototype.observations).every(
        (observation) => observation.status === "pending"
      )
    ).toBe(true);
  });

  test("pending four-gray evidence rejects a malformed supplied firmware commit", () => {
    const report = createPendingReport({
      runId: "malformed-pending-four-gray-commit",
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.fourGrayPrototype = createPendingFourGrayPrototype();
    report.fourGrayPrototype.firmwareCommit = "not-a-commit";

    expect(validateReport(report)).toContain(
      "fourGrayPrototype firmwareCommit must be null or a 40-character lowercase hexadecimal commit"
    );
  });

  test.each([
    ["refreshDurationMilliseconds", "1200"],
    ["psramHeadroomBeforeBytes", "500000"],
    ["psramHeadroomAfterBytes", "400000"]
  ])("pending four-gray evidence rejects a string %s", (field, value) => {
    const report = createPendingReport({
      runId: `malformed-pending-${field}`,
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.fourGrayPrototype = createPendingFourGrayPrototype();
    report.fourGrayPrototype[field] = value;

    expect(validateReport(report)).toContain(
      `fourGrayPrototype ${field} must be null or a valid integer`
    );
  });

  test("pending four-gray evidence rejects a malformed supplied observation timestamp", () => {
    const report = createPendingReport({
      runId: "malformed-pending-observed-at",
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.fourGrayPrototype = createPendingFourGrayPrototype();
    report.fourGrayPrototype.observations.ghosting.observedAt = "yesterday";

    expect(validateReport(report)).toContain(
      "fourGrayPrototype ghosting observedAt must be null or an ISO 8601 timestamp"
    );
  });

  test("a four-gray prototype pass requires complete physical evidence", () => {
    const report = createPendingReport({
      runId: "incomplete-four-gray-pass",
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.fourGrayPrototype = createPendingFourGrayPrototype();
    report.fourGrayPrototype.status = "pass";

    expect(validateReport(report)).toEqual(
      expect.arrayContaining([
        "fourGrayPrototype pass requires a 40-character firmwareCommit",
        "fourGrayPrototype pass requires refreshDurationMilliseconds",
        "fourGrayPrototype pass requires psramHeadroomBeforeBytes",
        "fourGrayPrototype pass requires psramHeadroomAfterBytes",
        "fourGrayPrototype pass requires passing physical observations"
      ])
    );
  });

  test("a four-gray prototype pass rejects invalid timestamps and undocumented ghosting", () => {
    const report = createPassingFourGrayReport();
    report.fourGrayPrototype.observations.refreshCompletion.observedAt =
      "October 17, 2026";
    report.fourGrayPrototype.observations.ghosting.notes = "";

    expect(validateReport(report)).toEqual(
      expect.arrayContaining([
        "fourGrayPrototype refreshCompletion observedAt must be null or an ISO 8601 timestamp",
        "fourGrayPrototype ghosting pass requires notes describing visible ghosting"
      ])
    );
  });

  test("a four-gray prototype pass accepts complete documented physical evidence", () => {
    expect(validateReport(createPassingFourGrayReport())).toEqual([]);
  });

  test("a generated report explicitly leaves every hardware observation pending", () => {
    const report = createPendingReport({
      runId: "2026-10-07-device-1",
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });

    expect(validateReport(report)).toEqual([]);
    expect(
      Object.values(report.hardware.observations).every(
        (observation) => observation.status === "pending"
      )
    ).toBe(true);
    expect(report.hardware.observations).toMatchObject({
      viewSetMemoryHeadroom: { status: "pending" },
      partialFailurePreservation: { status: "pending" },
      offlineNavigation: { status: "pending" },
    });
    expect(report.battery.status).toBe("pending");
  });

  test("does not permit a four-week battery pass without 28 days of measurements", () => {
    const report = createPendingReport({
      runId: "battery-short",
      baseUrl: "https://device.example.com",
      firmwareVersion: "1.2.3",
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.battery = {
      status: "pass",
      startedAt: "2026-10-01T00:00:00.000Z",
      endedAt: "2026-10-08T00:00:00.000Z",
      startChargePercent: 100,
      endChargePercent: 80,
      scheduledWakes: 28,
      shortPresses: 4,
      recharges: 0,
      wifiConditions: "normal",
      notes: "No recharge"
    };

    expect(validateReport(report)).toContain(
      "battery pass requires at least 28 elapsed days"
    );
  });

  test("failed hardware observations require non-sensitive notes", () => {
    const report = createPendingReport({
      runId: "failure",
      baseUrl: "https://device.example.com",
      firmwareVersion: "1.2.3",
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.hardware.observations.orientation.status = "fail";

    expect(validateReport(report)).toContain(
      "hardware orientation failure requires notes"
    );
  });

  test("an automated pass requires both validated image artifacts", () => {
    const report = createPendingReport({
      runId: "missing-artifact",
      baseUrl: "https://device.example.com",
      firmwareVersion: "1.2.3",
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: { status: "pass", checks: [], artifacts: [] }
    });

    expect(validateReport(report)).toContain(
      "automated pass requires validated Daily Brief and Calendar View artifacts"
    );
  });

  test("discovered hardware limits must be applied to the validation configuration", () => {
    const report = createPendingReport({
      runId: "new-limit",
      baseUrl: "https://device.example.com",
      firmwareVersion: "1.2.3",
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated: AUTOMATED_PASS
    });
    report.discoveredLimits.maximumImageBytes = 750_000;

    expect(
      validateReport(report, {
        maximumImageBytes: 1_000_000,
        minimumVisibleTextPixels: 14
      })
    ).toContain(
      "discovered maximumImageBytes must be applied to config/device-limits.json"
    );
  });
});

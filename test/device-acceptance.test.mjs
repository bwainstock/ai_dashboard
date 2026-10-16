import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import {
  createPendingReport,
  runProductionAcceptance,
  validateDisplaySequence,
  validatePngArtifact,
  validateReport
} from "../scripts/device-acceptance-lib.mjs";

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

describe("device acceptance artifacts", () => {
  test("production acceptance pins an explicitly selected complete generation", async () => {
    const requests = [];
    let currentGeneration = "generation-a";
    const images = {
      daily_brief: png(),
      calendar: png()
    };
    const fetchImpl = async (input, init = {}) => {
      const url = new URL(input);
      const headers = {
        get(name) {
          const entry = Object.entries(init.headers ?? {}).find(
            ([key]) => key.toLowerCase() === name.toLowerCase()
          );
          return entry?.[1] ?? null;
        }
      };
      requests.push({ url, method: init.method ?? "GET", headers });
      const view = url.searchParams.get("view");
      const generation =
        url.searchParams.get("generation") ?? currentGeneration;
      if (headers.get("Access-Token") !== "device-token") {
        return new Response(null, { status: 401 });
      }
      if (init.method === "HEAD") {
        if (view === "calendar") currentGeneration = "generation-b";
        return new Response(null, {
          headers: {
            etag: `"${view}-etag"`,
            "x-dashboard-filename":
              view === "daily_brief"
                ? `daily-brief-${generation}.png`
                : `calendar-view-${generation}.png`,
            "x-dashboard-generation": generation,
            "x-dashboard-view": view
          }
        });
      }
      if (headers.get("If-None-Match") === `"${view}-etag"`) {
        return new Response(null, {
          status: 304,
          headers: {
            etag: `"${view}-etag"`,
            "x-dashboard-filename":
              view === "daily_brief"
                ? `daily-brief-${generation}.png`
                : `calendar-view-${generation}.png`,
            "x-dashboard-generation": generation,
            "x-dashboard-view": view
          }
        });
      }
      return new Response(images[view], {
        headers: {
          "content-type": "image/png",
          etag: `"${view}-etag"`,
          "x-dashboard-filename":
            view === "daily_brief"
              ? `daily-brief-${generation}.png`
              : `calendar-view-${generation}.png`,
          "x-dashboard-generation": generation,
          "x-dashboard-view": view
        }
      });
    };

    const automated = await runProductionAcceptance({
      baseUrl: "https://device.example.com",
      deviceId: "device-id",
      accessToken: "device-token",
      maximumImageBytes: 1_000_000,
      imageWidth: 800,
      imageHeight: 480,
      fetchImpl
    });

    expect(automated.error).toBeUndefined();
    expect(automated).toMatchObject({ status: "pass" });
    expect(automated.generation).toBe("generation-a");
    expect(automated.artifacts).toHaveLength(2);
    expect(automated.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          view: "daily_brief",
          generation: "generation-a",
          etag: '"daily_brief-etag"'
        }),
        expect.objectContaining({
          view: "calendar",
          generation: "generation-a",
          etag: '"calendar-etag"'
        })
      ])
    );
    expect(
      requests
        .filter(({ method }) => method === "GET")
        .every(
          ({ url }) => url.searchParams.get("generation") === "generation-a"
        )
    ).toBe(true);
    expect(
      requests.every(
        ({ url, headers }) =>
          !url.href.includes("device-id") &&
          !url.href.includes("device-token") &&
          headers.get("ID") === "device-id"
      )
    ).toBe(true);
    expect(
      requests.filter(
        ({ headers }) => headers.get("Access-Token") !== "device-token"
      )
    ).toHaveLength(8);
    expect(
      requests.every(({ url }) =>
        ["daily_brief", "calendar"].includes(url.searchParams.get("view"))
      )
    ).toBe(true);
  });

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
    expect(report.battery.status).toBe("pending");
    expect(JSON.stringify(report)).not.toContain("device-token");
    expect(JSON.stringify(report)).not.toContain("device-id");
  });

  test("a protocol failure is recorded separately from pending physical observations", async () => {
    const automated = await runProductionAcceptance({
      baseUrl: "https://device.example.com",
      deviceId: "device-id",
      accessToken: "device-token",
      maximumImageBytes: 1_000_000,
      imageWidth: 800,
      imageHeight: 480,
      fetchImpl: async () => new Response(null, { status: 503 })
    });
    const report = createPendingReport({
      runId: "protocol-failure",
      baseUrl: "https://device.example.com",
      firmwareVersion: null,
      panelModel: "Seeed/TRMNL 7.5-inch OG DIY Kit",
      automated
    });

    expect(report.automated.status).toBe("fail");
    expect(
      Object.values(report.hardware.observations).every(
        (observation) => observation.status === "pending"
      )
    ).toBe(true);
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
        minimumVisibleTextPixels: 12
      })
    ).toContain(
      "discovered maximumImageBytes must be applied to config/device-limits.json"
    );
  });
});

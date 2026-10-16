import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  createPhysicalSetupOperations,
  createPhysicalAcceptanceResult,
  redactCapturedOutput,
  runPhysicalAcceptanceSetup,
  writePrivateJsonReport
} from "../scripts/physical-device-setup-lib.mjs";

const firmware = Buffer.from("compiled firmware");
const firmwareIdentity = createHash("sha256").update(firmware).digest("hex");

describe("physical device acceptance setup", () => {
  test("compiles pinned firmware, skips unchanged OTA, resets, and captures activation evidence", async () => {
    const actions = [];
    const result = await runPhysicalAcceptanceSetup({
      installedFirmwareIdentity: firmwareIdentity,
      compile: async () => actions.push("compile"),
      readFirmware: async () => firmware,
      upload: async () => actions.push("upload"),
      requestReset: async () => actions.push("reset"),
      captureSerial: async () => {
        actions.push("serial");
        return {
          exitCode: 0,
          output:
            "[I] Activated generation generation-2026-10-16 with 7340032 bytes PSRAM headroom"
        };
      }
    });

    expect(actions).toEqual(["compile", "reset", "serial"]);
    expect(result).toMatchObject({
      status: "pass",
      firmwareIdentity: `sha256:${firmwareIdentity}`,
      delivery: "reset",
      activatedGeneration: "generation-2026-10-16",
      psramHeadroomBytes: 7_340_032
    });
  });

  test("uploads changed firmware before capturing evidence", async () => {
    const actions = [];
    const result = await runPhysicalAcceptanceSetup({
      installedFirmwareIdentity: "different-identity",
      compile: async () => actions.push("compile"),
      readFirmware: async () => firmware,
      upload: async () => actions.push("upload"),
      requestReset: async () => actions.push("reset"),
      captureSerial: async () => ({
        exitCode: 0,
        output: "Activated generation gen-b with 6000000 bytes PSRAM headroom"
      })
    });

    expect(actions).toEqual(["compile", "upload"]);
    expect(result.delivery).toBe("ota");
  });

  test("reconnects serial capture after a USB reset disconnect", async () => {
    let attempts = 0;
    const result = await runPhysicalAcceptanceSetup({
      installedFirmwareIdentity: firmwareIdentity,
      compile: async () => {},
      readFirmware: async () => firmware,
      upload: async () => {},
      requestReset: async () => {},
      captureSerial: async () => {
        attempts += 1;
        if (attempts === 1) {
          return { exitCode: 1, output: "Serial port disconnected" };
        }
        return {
          exitCode: 0,
          output: "Activated generation gen-c with 5000000 bytes PSRAM headroom"
        };
      }
    });

    expect(attempts).toBe(2);
    expect(result.serialReconnects).toBe(1);
    expect(result.activatedGeneration).toBe("gen-c");
  });

  test("redacts credentials, device and Wi-Fi identifiers, and household content", () => {
    const redacted = redactCapturedOutput(
      [
        "Authorization: Bearer top-secret",
        "Access-Token: device-token",
        "ID: raw-device-id",
        "WiFi SSID: Home Network",
        "Connecting to /dev/cu.usbmodem-household",
        "Daily Brief: Alex soccer practice at 4 PM",
        "Activated generation safe-generation with 7340032 bytes PSRAM headroom"
      ].join("\n"),
      {
        sensitiveValues: ["top-secret", "device-token", "raw-device-id"]
      }
    );

    expect(redacted).not.toMatch(
      /top-secret|device-token|raw-device-id|Home Network|usbmodem-household|Alex|soccer/i
    );
    expect(redacted).toContain(
      "Activated generation safe-generation with 7340032 bytes PSRAM headroom"
    );
  });

  test("records an explicit failure without attempting delivery when compilation fails", async () => {
    let uploaded = false;
    const result = await runPhysicalAcceptanceSetup({
      compile: async () => {
        throw new Error("ESPHome compile failed");
      },
      readFirmware: async () => firmware,
      upload: async () => {
        uploaded = true;
      },
      requestReset: async () => {},
      captureSerial: async () => ({ exitCode: 0, output: "" })
    });

    expect(uploaded).toBe(false);
    expect(result).toMatchObject({
      status: "fail",
      error: "ESPHome compile failed",
      checks: [
        { name: "pinned ESPHome firmware compilation", status: "fail" }
      ]
    });
  });

  test("combines protocol checks and setup evidence without passing human observations", () => {
    const automated = createPhysicalAcceptanceResult({
      protocol: {
        status: "pass",
        checks: [{ name: "authenticated image boundaries", status: "pass" }],
        generation: "generation-a",
        artifacts: [{ filename: "daily-brief-generation-a.png" }]
      },
      setup: {
        status: "pass",
        checks: [{ name: "pinned ESPHome firmware compilation", status: "pass" }],
        firmwareIdentity: `sha256:${firmwareIdentity}`,
        delivery: "reset",
        serialReconnects: 1,
        activatedGeneration: "generation-a",
        psramHeadroomBytes: 7_340_032
      }
    });

    expect(automated).toMatchObject({
      status: "pass",
      generation: "generation-a",
      physicalSetup: {
        status: "pass",
        firmwareIdentity: `sha256:${firmwareIdentity}`,
        delivery: "reset",
        serialReconnects: 1,
        activatedGeneration: "generation-a",
        psramHeadroomBytes: 7_340_032
      }
    });
    expect(automated.checks).toHaveLength(2);
  });

  test("uses pinned package commands and resets only the first serial reconnect attempt", async () => {
    const commands = [];
    const operations = createPhysicalSetupOperations({
      firmwarePath: "firmware.bin",
      otaTarget: "family-dashboard.local",
      serialDevice: "/dev/cu.usbmodem-test",
      readFile: async () => firmware,
      runCommand: async (command, args) => {
        commands.push([command, ...args]);
        return { exitCode: 0, output: "" };
      }
    });

    await operations.compile();
    await operations.requestReset();
    await operations.captureSerial(0);
    await operations.captureSerial(1);
    await operations.upload();

    expect(commands).toEqual([
      ["npm", "run", "esphome:compile"],
      [
        "npm",
        "run",
        "esphome:logs",
        "--",
        "--device",
        "/dev/cu.usbmodem-test",
        "--reset"
      ],
      [
        "npm",
        "run",
        "esphome:logs",
        "--",
        "--device",
        "/dev/cu.usbmodem-test"
      ],
      [
        "npm",
        "run",
        "esphome:upload",
        "--",
        "--device",
        "family-dashboard.local"
      ]
    ]);
    expect(await operations.readFirmware()).toEqual(firmware);
  });

  test("writes the report with owner-only permissions even when replacing a file", async () => {
    const calls = [];
    await writePrivateJsonReport("evidence/device/report.json", { ok: true }, {
      mkdir: async (...args) => calls.push(["mkdir", ...args]),
      writeFile: async (...args) => calls.push(["writeFile", ...args]),
      chmod: async (...args) => calls.push(["chmod", ...args])
    });

    expect(calls).toEqual([
      ["mkdir", "evidence/device", { recursive: true }],
      [
        "writeFile",
        "evidence/device/report.json",
        '{\n  "ok": true\n}\n',
        { mode: 0o600 }
      ],
      ["chmod", "evidence/device/report.json", 0o600]
    ]);
  });
});

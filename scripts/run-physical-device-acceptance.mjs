import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  createPendingReport,
  runProductionAcceptance,
  validateReport
} from "./device-acceptance-lib.mjs";
import {
  COMPILED_OTA_FIRMWARE_URL,
  createPhysicalAcceptanceResult,
  createPhysicalSetupOperations,
  runPhysicalAcceptanceSetup,
  writePrivateJsonReport
} from "./physical-device-setup-lib.mjs";

const [baseUrl, reportPath] = process.argv.slice(2);
const {
  DEVICE_ID: deviceId,
  DEVICE_TOKEN: accessToken,
  ESPHOME_OTA_TARGET: otaTarget,
  ESPHOME_SERIAL_DEVICE: serialDevice
} = process.env;
if (
  !baseUrl ||
  !reportPath ||
  !deviceId ||
  !accessToken ||
  !otaTarget ||
  !serialDevice
) {
  console.error(
    "Usage: DEVICE_ID=... DEVICE_TOKEN=... ESPHOME_OTA_TARGET=... ESPHOME_SERIAL_DEVICE=... npm run acceptance:physical -- https://device.example.com evidence/device-acceptance/report.json"
  );
  process.exit(2);
}

function runCommand(command, args, { stopWhen, timeoutMs = 60_000 } = {}) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let matched = false;
    let timedOut = false;
    const collect = (chunk) => {
      output += chunk.toString();
      if (output.length > 2_000_000) output = output.slice(-2_000_000);
      if (!matched && stopWhen?.test(output)) {
        matched = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.on("error", () => {
      resolveResult({ exitCode: 127, output: "" });
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveResult({
        exitCode: matched ? 0 : timedOut ? 124 : (code ?? 1),
        output
      });
    });
  });
}

const limits = JSON.parse(
  await readFile(new URL("../config/device-limits.json", import.meta.url), "utf8")
);
const origin = new URL(baseUrl).origin;
const installedFirmwareIdentity = (
  process.env.INSTALLED_FIRMWARE_IDENTITY ?? ""
).replace(/^sha256:/, "");
const operations = createPhysicalSetupOperations({
  firmwarePath: COMPILED_OTA_FIRMWARE_URL,
  otaTarget,
  serialDevice,
  readFile,
  runCommand
});

console.log("Compiling pinned ESPHome firmware and preparing device evidence...");
const setup = await runPhysicalAcceptanceSetup({
  installedFirmwareIdentity,
  ...operations,
  sensitiveValues: [deviceId, accessToken, otaTarget, serialDevice]
});
const protocol = await runProductionAcceptance({
  baseUrl: origin,
  deviceId,
  accessToken,
  maximumImageBytes: limits.maximumImageBytes,
  imageWidth: limits.imageWidth,
  imageHeight: limits.imageHeight
});
const automated = createPhysicalAcceptanceResult({ protocol, setup });
const report = createPendingReport({
  runId: new Date().toISOString().replaceAll(/[:.]/g, "-"),
  baseUrl: origin,
  firmwareVersion: setup.firmwareIdentity ?? null,
  panelModel: limits.panelModel,
  automated
});
const errors = validateReport(report, limits);
if (errors.length > 0) {
  console.error("Acceptance report construction failed validation");
  process.exit(1);
}

const output = resolve(reportPath);
await writePrivateJsonReport(output, report, {
  mkdir,
  writeFile,
  chmod
});
console.log(
  JSON.stringify(
    {
      report: output,
      automated: automated.status,
      delivery: setup.delivery ?? null,
      firmwareIdentity: setup.firmwareIdentity ?? null,
      activatedGeneration: setup.activatedGeneration ?? null,
      psramHeadroomBytes: setup.psramHeadroomBytes ?? null,
      humanObservations: "pending"
    },
    null,
    2
  )
);
if (automated.status === "fail") process.exitCode = 1;

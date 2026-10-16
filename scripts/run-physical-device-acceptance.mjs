import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { clearTimeout, setTimeout } from "node:timers";
import { stdin, stdout } from "node:process";
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
import {
  acceptanceEvidencePath,
  assertSanitizedReport,
  physicalAcceptanceStatus,
  postSuccessfulIssueSummary,
  runGuidedObservations
} from "./physical-device-scenarios-lib.mjs";

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

const origin = new URL(baseUrl).origin;
const output = acceptanceEvidencePath(reportPath);
const limits = JSON.parse(
  await readFile(new URL("../config/device-limits.json", import.meta.url), "utf8")
);
const installedFirmwareIdentity = (
  process.env.INSTALLED_FIRMWARE_IDENTITY ?? ""
).replace(/^sha256:/, "");
const sensitiveValues = [deviceId, accessToken, otaTarget, serialDevice].filter(
  Boolean
);
const fileOperations = {
  mkdir,
  writeFile,
  chmod
};
let report;
try {
  await access(output);
  report = JSON.parse(await readFile(output, "utf8"));
  if (report.target.baseUrl !== origin) {
    throw new Error("Existing report target does not match the requested origin");
  }
  console.log(`Resuming pending observations in ${relative(process.cwd(), output)}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
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
    sensitiveValues
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
  report = createPendingReport({
    runId: new Date().toISOString().replaceAll(/[:.]/g, "-"),
    baseUrl: origin,
    firmwareVersion: setup.firmwareIdentity ?? null,
    panelModel: limits.panelModel,
    automated
  });
  assertSanitizedReport(report, { sensitiveValues });
  await writePrivateJsonReport(output, report, fileOperations);
}

const initialErrors = validateReport(report, limits);
if (initialErrors.length > 0) {
  console.error(`Acceptance report validation failed: ${initialErrors.join("; ")}`);
  process.exit(1);
}

if (report.automated.status === "pass") {
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    await runGuidedObservations(report, {
      isHumanInteractive: Boolean(stdin.isTTY && stdout.isTTY),
      sensitiveValues,
      ask: (prompt) => readline.question(prompt),
      onTransition: async () => {
        assertSanitizedReport(report, { sensitiveValues });
        await writePrivateJsonReport(output, report, fileOperations);
      }
    });
  } finally {
    readline.close();
  }
}

assertSanitizedReport(report, { sensitiveValues });
const errors = validateReport(report, limits);
if (errors.length > 0) {
  console.error(`Acceptance report validation failed: ${errors.join("; ")}`);
  process.exit(1);
}
await writePrivateJsonReport(output, report, fileOperations);
const physicalStatus = physicalAcceptanceStatus(report);
if (physicalStatus === "pass" && report.issueSummary.status !== "posted") {
  const postedAt = new Date().toISOString();
  await postSuccessfulIssueSummary(
    {
      runId: report.runId,
      reportPath: relative(process.cwd(), output),
      completedAt: postedAt,
      firmwareIdentity: report.automated.physicalSetup.firmwareIdentity,
      generation: report.automated.generation
    },
    {
      runCommand: (command, ...args) => runCommand(command, args)
    }
  );
  report.issueSummary = { issue: 38, status: "posted", postedAt };
  await writePrivateJsonReport(output, report, fileOperations);
}
console.log(
  JSON.stringify(
    {
      report: output,
      automated: report.automated.status,
      physical: physicalStatus,
      issueSummary: report.issueSummary.status
    },
    null,
    2
  )
);
if (report.automated.status === "fail" || physicalStatus === "fail") {
  process.exitCode = 1;
}

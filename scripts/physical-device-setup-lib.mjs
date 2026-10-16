import { createHash } from "node:crypto";
import { dirname } from "node:path";

export const COMPILED_OTA_FIRMWARE_URL = new URL(
  "../esphome/.esphome/build/family-dashboard/build/firmware.ota.bin",
  import.meta.url
);

const SAFE_CAPTURE_PATTERNS = [
  /Activated generation \S+ with \d+ bytes PSRAM headroom/,
  /serial (?:port )?(?:connected|disconnected|reconnected)/i,
  /firmware (?:compiled|uploaded|unchanged)/i
];

export async function writePrivateJsonReport(
  path,
  report,
  { mkdir, writeFile, chmod }
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function createPhysicalSetupOperations({
  firmwarePath,
  otaTarget,
  serialDevice,
  readFile,
  runCommand
}) {
  let resetOnNextCapture = false;
  const runRequired = async (label, command, args, options) => {
    const result = await runCommand(command, args, options);
    if (result.exitCode !== 0) throw new Error(`${label} failed`);
    return result;
  };
  return {
    compile: () =>
      runRequired("ESPHome compile", "npm", ["run", "esphome:compile"], {
        timeoutMs: 10 * 60_000
      }),
    readFirmware: () => readFile(firmwarePath),
    upload: () =>
      runRequired(
        "ESPHome OTA upload",
        "npm",
        ["run", "esphome:upload", "--", "--device", otaTarget],
        {
          timeoutMs: 5 * 60_000
        }
      ),
    requestReset: async () => {
      resetOnNextCapture = true;
    },
    captureSerial: (attempt) => {
      const shouldReset = resetOnNextCapture && attempt === 0;
      if (shouldReset) resetOnNextCapture = false;
      return runCommand(
        "npm",
        [
          "run",
          "esphome:logs",
          "--",
          "--device",
          serialDevice,
          ...(shouldReset ? ["--reset"] : [])
        ],
        {
          stopWhen: /Activated generation \S+ with \d+ bytes PSRAM headroom/,
          timeoutMs: 2 * 60_000
        }
      );
    }
  };
}

export function redactCapturedOutput(output, { sensitiveValues = [] } = {}) {
  let redacted = String(output);
  for (const value of sensitiveValues.filter(Boolean)) {
    redacted = redacted.replaceAll(value, "[REDACTED]");
  }
  return redacted
    .split(/\r?\n/)
    .map((line) => {
      const safe = SAFE_CAPTURE_PATTERNS.find((pattern) => pattern.test(line));
      return safe ? line.match(safe)[0] : "[REDACTED NON-OPERATIONAL OUTPUT]";
    })
    .join("\n");
}

export function createPhysicalAcceptanceResult({ protocol, setup }) {
  const generationsMatch =
    protocol.status !== "pass" ||
    setup.status !== "pass" ||
    protocol.generation === setup.activatedGeneration;
  const checks = [...(protocol.checks ?? []), ...(setup.checks ?? [])];
  if (!generationsMatch) {
    checks.push({
      name: "activated generation matches deployed acceptance",
      status: "fail"
    });
  }
  const status =
    protocol.status === "pass" && setup.status === "pass" && generationsMatch
      ? "pass"
      : "fail";
  return {
    status,
    checks,
    ...(protocol.generation ? { generation: protocol.generation } : {}),
    ...(protocol.artifacts ? { artifacts: protocol.artifacts } : {}),
    physicalSetup: setup,
    ...(status === "fail"
      ? {
          error:
            setup.error ??
            protocol.error ??
            "Activated generation does not match deployed acceptance"
        }
      : {})
  };
}

function extractActivationEvidence(output) {
  const match = output.match(
    /Activated generation (\S+) with (\d+) bytes PSRAM headroom/
  );
  if (!match) {
    throw new Error(
      "Serial capture did not report an activated generation and PSRAM headroom"
    );
  }
  return {
    activatedGeneration: match[1],
    psramHeadroomBytes: Number(match[2])
  };
}

export async function runPhysicalAcceptanceSetup({
  installedFirmwareIdentity,
  compile,
  readFirmware,
  upload,
  requestReset,
  captureSerial,
  serialAttempts = 3,
  sensitiveValues = []
}) {
  const checks = [];
  try {
    await compile();
    const firmwareIdentity = createHash("sha256")
      .update(await readFirmware())
      .digest("hex");
    checks.push({
      name: "pinned ESPHome firmware compilation",
      status: "pass"
    });
    const unchanged = installedFirmwareIdentity === firmwareIdentity;
    if (unchanged) await requestReset();
    else await upload();
    checks.push({
      name: unchanged
        ? "unchanged firmware reset without OTA"
        : "changed firmware delivered by OTA",
      status: "pass"
    });
    let evidence;
    let serialReconnects = 0;
    for (let attempt = 0; attempt < serialAttempts; attempt += 1) {
      const capture = await captureSerial(attempt);
      const redactedOutput = redactCapturedOutput(capture.output, {
        sensitiveValues
      });
      try {
        evidence = extractActivationEvidence(redactedOutput);
        break;
      } catch (error) {
        if (attempt === serialAttempts - 1) throw error;
        serialReconnects += 1;
      }
    }
    checks.push({
      name: "serial reconnection captured activation evidence",
      status: "pass"
    });
    return {
      status: "pass",
      checks,
      firmwareIdentity: `sha256:${firmwareIdentity}`,
      delivery: unchanged ? "reset" : "ota",
      serialReconnects,
      ...evidence
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Setup failed";
    checks.push({
      name:
        checks.length === 0
          ? "pinned ESPHome firmware compilation"
          : checks.length === 1
            ? "firmware delivery or reset"
            : "serial reconnection captured activation evidence",
      status: "fail"
    });
    return {
      status: "fail",
      checks,
      error: sensitiveValues.reduce(
        (redacted, value) =>
          value ? redacted.replaceAll(value, "[REDACTED]") : redacted,
        message
      )
    };
  }
}

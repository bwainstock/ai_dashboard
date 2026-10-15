import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPendingReport,
  secondsUntilNextSlot,
  validateDisplaySequence,
  validatePngArtifact
} from "./device-acceptance-lib.mjs";
import {
  requestByosManifest,
  requestPrivatePng
} from "./byos-manifest-lib.mjs";

const [baseUrl, reportPath] = process.argv.slice(2);
const deviceId = process.env.DEVICE_ID;
const token = process.env.DEVICE_TOKEN;
if (!baseUrl || !reportPath || !deviceId || !token) {
  console.error(
    "Usage: DEVICE_ID=... DEVICE_TOKEN=... npm run acceptance:run -- https://device.example.com evidence/device.json"
  );
  process.exit(2);
}

const limits = JSON.parse(
  await readFile(new URL("../config/device-limits.json", import.meta.url), "utf8")
);
const origin = new URL(baseUrl).origin;
const checks = [];
const artifacts = [];

async function display(updateSource) {
  return requestByosManifest({
    deviceOrigin: origin,
    deviceId,
    accessToken: token,
    wakeSource: updateSource
  });
}

async function expectUnauthorized(url, headers, label) {
  const response = await fetch(url, { headers });
  if (response.status !== 401) {
    throw new Error(`${label} returned ${response.status}; expected 401`);
  }
  checks.push({ name: label, status: "pass" });
}

let automated;
try {
  await expectUnauthorized(
    new URL("/api/display", origin),
    { ID: deviceId },
    "display rejects a missing token"
  );
  await expectUnauthorized(
    new URL("/api/display", origin),
    { ID: deviceId, "Access-Token": `${token}-invalid` },
    "display rejects an invalid token"
  );

  const requestedAt = new Date();
  const responses = [];
  for (const source of ["timer", "timer", "button", "button", "timer"]) {
    responses.push(await display(source));
  }
  const sequence = validateDisplaySequence(
    responses.map(({ filename }) => filename)
  );
  checks.push(
    { name: "named image cache remains stable", status: "pass" },
    {
      name: "button alternates Daily Brief and Calendar View",
      status: "pass"
    },
    { name: "timer resets to Daily Brief", status: "pass" }
  );

  const expectedWake = secondsUntilNextSlot(
    requestedAt,
    limits.schedule.timezone,
    limits.schedule.slots
  );
  if (
    responses[0].refreshRateSeconds !== expectedWake &&
    Math.abs(responses[0].refreshRateSeconds - expectedWake) > 2
  ) {
    throw new Error(
      `refresh_rate ${responses[0].refreshRateSeconds} differs from expected ${expectedWake}`
    );
  }
  checks.push({ name: "scheduled wake interval matches configured slots", status: "pass" });

  for (const [prefix, response] of [
    ["daily-brief", responses[0]],
    ["calendar-view", responses[2]]
  ]) {
    await expectUnauthorized(
      response.imageUrl,
      { ID: deviceId },
      `${prefix} image rejects a missing token`
    );
    const imageResponse = await requestPrivatePng({
      imageUrl: response.imageUrl,
      deviceId,
      accessToken: token
    });
    artifacts.push(
      validatePngArtifact(
        Buffer.from(await imageResponse.arrayBuffer()),
        response.filename,
        prefix,
        limits.maximumImageBytes,
        limits.imageWidth,
        limits.imageHeight
      )
    );
  }
  checks.push(
    { name: "both images decode and satisfy configured limits", status: "pass" },
    { name: "all image routes remain device-token authenticated", status: "pass" }
  );
  automated = { status: "pass", checks, sequence, artifacts };
} catch (error) {
  automated = {
    status: "fail",
    checks,
    error: error instanceof Error ? error.message : "acceptance failed"
  };
}

const report = createPendingReport({
  runId: new Date().toISOString().replaceAll(/[:.]/g, "-"),
  baseUrl: origin,
  firmwareVersion: process.env.FIRMWARE_VERSION ?? null,
  panelModel: limits.panelModel,
  automated
});
const output = resolve(reportPath);
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600
});
console.log(JSON.stringify({ report: output, automated: automated.status }, null, 2));
if (automated.status === "fail") process.exitCode = 1;

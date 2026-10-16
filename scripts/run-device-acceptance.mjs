import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  createPendingReport,
  runProductionAcceptance
} from "./device-acceptance-lib.mjs";

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
const automated = await runProductionAcceptance({
  baseUrl: origin,
  deviceId,
  accessToken: token,
  maximumImageBytes: limits.maximumImageBytes,
  imageWidth: limits.imageWidth,
  imageHeight: limits.imageHeight
});

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

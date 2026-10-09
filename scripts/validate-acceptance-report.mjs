import { readFile } from "node:fs/promises";
import { validateReport } from "./device-acceptance-lib.mjs";

const [reportPath] = process.argv.slice(2);
if (!reportPath) {
  console.error(
    "Usage: npm run acceptance:validate -- evidence/device-acceptance.json"
  );
  process.exit(2);
}
const report = JSON.parse(await readFile(reportPath, "utf8"));
const limits = JSON.parse(
  await readFile(new URL("../config/device-limits.json", import.meta.url), "utf8")
);
const errors = validateReport(report, limits);
if (errors.length > 0) {
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(
  JSON.stringify(
    {
      valid: true,
      automated: report.automated.status,
      hardwarePending: Object.values(report.hardware.observations).filter(
        ({ status }) => status === "pending"
      ).length,
      battery: report.battery.status
    },
    null,
    2
  )
);

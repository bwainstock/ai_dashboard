import { PNG } from "pngjs";

export const HARDWARE_OBSERVATIONS = [
  "orientation",
  "readability",
  "icons",
  "pngDecoding",
  "namedImageCaching",
  "buttonCycle",
  "timerReset",
  "wifiReconnection",
  "scheduledWakes",
  "authenticatedPrivacy"
];

function generationFrom(filename, prefix) {
  const match = filename.match(new RegExp(`^${prefix}-(.+)\\.png$`));
  if (!match) throw new Error(`${filename} is not a ${prefix} named PNG`);
  return match[1];
}

export function validatePngArtifact(
  bytes,
  filename,
  expectedPrefix,
  maximumBytes,
  expectedWidth = 800,
  expectedHeight = 480
) {
  if (bytes.byteLength > maximumBytes) {
    throw new Error(
      `${filename} is ${bytes.byteLength} bytes; limit is ${maximumBytes}`
    );
  }
  generationFrom(filename, expectedPrefix);
  let png;
  try {
    png = PNG.sync.read(bytes);
  } catch (error) {
    throw new Error(
      `${filename} is not a decodable PNG: ${
        error instanceof Error ? error.message : "decode failed"
      }`
    );
  }
  if (png.width !== expectedWidth || png.height !== expectedHeight) {
    throw new Error(
      `${filename} is ${png.width}x${png.height}; expected ${expectedWidth}x${expectedHeight}`
    );
  }
  const tones = new Set();
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    const alpha = png.data[offset + 3];
    if (red !== green || green !== blue || alpha !== 255) {
      throw new Error(`${filename} contains color or transparency`);
    }
    tones.add(red);
  }
  if (tones.size < 2) throw new Error(`${filename} is blank`);
  return {
    filename,
    byteSize: bytes.byteLength,
    dimensions: `${png.width}x${png.height}`,
    monochrome: true,
    nonBlank: true
  };
}

export function validateDisplaySequence(filenames) {
  if (filenames.length !== 6) {
    throw new Error("Display sequence must contain six requests");
  }
  const generation = generationFrom(filenames[0], "daily-brief");
  const expected = [
    `daily-brief-${generation}.png`,
    `daily-brief-${generation}.png`,
    `calendar-view-${generation}.png`,
    `lunch-view-${generation}.png`,
    `daily-brief-${generation}.png`,
    `daily-brief-${generation}.png`
  ];
  if (filenames.some((filename, index) => filename !== expected[index])) {
    throw new Error(
      "Display sequence does not preserve cache names, button order, generation, and timer reset"
    );
  }
  return {
    generation,
    cacheStable: true,
    buttonCycle: true,
    timerReset: true
  };
}

export function secondsUntilNextSlot(now, timezone, slots) {
  const start = Math.floor(now.getTime() / 60_000) * 60_000 + 60_000;
  for (let offset = 0; offset < 60 * 72; offset += 1) {
    const candidate = new Date(start + offset * 60_000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
      })
        .formatToParts(candidate)
        .filter(({ type }) => type !== "literal")
        .map(({ type, value }) => [type, value])
    );
    if (slots.includes(`${parts.hour}:${parts.minute}`)) {
      return Math.ceil((candidate.getTime() - now.getTime()) / 1000);
    }
  }
  throw new Error("Schedule contains no future slot");
}

export function createPendingReport({
  runId,
  baseUrl,
  firmwareVersion,
  panelModel,
  automated
}) {
  return {
    schemaVersion: 1,
    runId,
    recordedAt: new Date().toISOString(),
    target: { baseUrl, panelModel, firmwareVersion },
    limitsConfiguration: "config/device-limits.json",
    automated,
    hardware: {
      observations: Object.fromEntries(
        HARDWARE_OBSERVATIONS.map((name) => [
          name,
          { status: "pending", observedAt: null, notes: "" }
        ])
      )
    },
    battery: {
      status: "pending",
      startedAt: null,
      endedAt: null,
      startChargePercent: null,
      endChargePercent: null,
      scheduledWakes: null,
      shortPresses: null,
      recharges: null,
      wifiConditions: "",
      notes: ""
    },
    discoveredLimits: {
      maximumImageBytes: null,
      minimumReadableTextPixels: null,
      notes: ""
    }
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function validateReport(report, configuredLimits) {
  const errors = [];
  if (report?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!nonEmpty(report?.runId)) errors.push("runId is required");
  if (!["pass", "fail"].includes(report?.automated?.status)) {
    errors.push("automated status must be pass or fail");
  }
  if (report?.automated?.status === "pass") {
    const filenames = (report.automated.artifacts ?? []).map(
      ({ filename }) => filename
    );
    if (
      !["daily-brief-", "calendar-view-", "lunch-view-"].every((prefix) =>
        filenames.some((filename) => filename.startsWith(prefix))
      )
    ) {
      errors.push(
        "automated pass requires validated Daily Brief, Calendar View, and Lunch View artifacts"
      );
    }
    if (
      !Array.isArray(report.automated.checks) ||
      report.automated.checks.some(({ status }) => status !== "pass")
    ) {
      errors.push("automated pass requires passing checks");
    }
  }
  for (const name of HARDWARE_OBSERVATIONS) {
    const observation = report?.hardware?.observations?.[name];
    if (!["pending", "pass", "fail"].includes(observation?.status)) {
      errors.push(`hardware ${name} status is invalid`);
    }
    if (observation?.status === "fail" && !nonEmpty(observation.notes)) {
      errors.push(`hardware ${name} failure requires notes`);
    }
    if (
      observation?.status !== "pending" &&
      !nonEmpty(observation.observedAt)
    ) {
      errors.push(`hardware ${name} result requires observedAt`);
    }
  }
  const battery = report?.battery;
  if (!["pending", "pass", "fail"].includes(battery?.status)) {
    errors.push("battery status is invalid");
  }
  if (battery?.status !== "pending") {
    const start = Date.parse(battery.startedAt);
    const end = Date.parse(battery.endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      errors.push("battery result requires a valid measurement interval");
    } else if (
      battery.status === "pass" &&
      end - start < 28 * 24 * 60 * 60 * 1000
    ) {
      errors.push("battery pass requires at least 28 elapsed days");
    }
    for (const field of [
      "startChargePercent",
      "endChargePercent",
      "scheduledWakes",
      "shortPresses",
      "recharges"
    ]) {
      if (!Number.isFinite(battery[field])) {
        errors.push(`battery ${field} is required`);
      }
    }
    if (!nonEmpty(battery.wifiConditions)) {
      errors.push("battery wifiConditions is required");
    }
    if (battery.status === "pass" && battery.recharges !== 0) {
      errors.push("battery pass requires zero recharges");
    }
  }
  if (configuredLimits) {
    const discovered = report?.discoveredLimits ?? {};
    if (
      Number.isFinite(discovered.maximumImageBytes) &&
      discovered.maximumImageBytes !== configuredLimits.maximumImageBytes
    ) {
      errors.push(
        "discovered maximumImageBytes must be applied to config/device-limits.json"
      );
    }
    if (
      Number.isFinite(discovered.minimumReadableTextPixels) &&
      discovered.minimumReadableTextPixels !==
        configuredLimits.minimumVisibleTextPixels
    ) {
      errors.push(
        "discovered minimumReadableTextPixels must be applied to config/device-limits.json"
      );
    }
  }
  return errors;
}

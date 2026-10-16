import { isAbsolute, relative, resolve, sep } from "node:path";

export const HUMAN_OBSERVATIONS = [
  {
    name: "offlineOnePressNavigation",
    guidance:
      "Make Wi-Fi unavailable, press Key 3 once, and confirm Calendar View appears without HTTP activity."
  },
  {
    name: "offlineTwoPressViewCycle",
    guidance:
      "While Wi-Fi remains unavailable, press Key 3 a second time and confirm Daily Brief completes the local two-press cycle."
  },
  {
    name: "scheduledDailyBriefReset",
    guidance:
      "Start on Calendar View, observe a successful scheduled refresh, and confirm the selection resets to Daily Brief."
  },
  {
    name: "downloadFailurePreservesPair",
    guidance:
      "Record the active generation, use the controlled test origin to make the Calendar View body request fail, trigger a refresh, then confirm the displayed image and previous complete pair remain active before restoring the origin."
  },
  {
    name: "decodeFailurePreservesPair",
    guidance:
      "Record the active generation, use the controlled test origin to return an invalid Calendar View PNG, trigger a refresh, then confirm the displayed image and previous complete pair remain active before restoring the origin."
  },
  {
    name: "unchangedGenerationNoDownload",
    guidance:
      "Revalidate an unchanged generation and confirm serial or server evidence shows no image-body download."
  },
  {
    name: "unchangedGenerationNoPanelRefresh",
    guidance:
      "During that unchanged-generation check, confirm the physical panel does not refresh."
  },
  {
    name: "displayReadability",
    guidance:
      "Confirm Daily Brief and Calendar View are readable at the agreed viewing distance without failed-decode output."
  },
  {
    name: "mechanicalSoundness",
    guidance:
      "Confirm the display orientation, enclosure, buttons, cable routing, and mounting are mechanically sound."
  }
];

const SENSITIVE_NOTE_PATTERN =
  /(access[-_ ]?token|authorization|device[_ -]?token|device[_ -]?id|password|passphrase|wi-?fi|ssid|bearer\s+|\/dev\/cu\.|household content)/i;

function safeSummaryValue(value, label) {
  if (
    typeof value !== "string" ||
    !value ||
    !/^[A-Za-z0-9._:/-]+$/.test(value)
  ) {
    throw new Error(`${label} is not safe for an issue summary`);
  }
  return value;
}

function validateHumanNote(note, sensitiveValues) {
  const trimmed = String(note ?? "").trim();
  if (!trimmed) throw new Error("A non-sensitive observation note is required");
  if (
    SENSITIVE_NOTE_PATTERN.test(trimmed) ||
    sensitiveValues.some((value) => value && trimmed.includes(value))
  ) {
    throw new Error(
      "Observation notes must exclude credentials, identifiers, Wi-Fi details, and household content"
    );
  }
  return trimmed;
}

export function assertSanitizedReport(
  report,
  { sensitiveValues = [] } = {}
) {
  const strings = [];
  const collectStrings = (value) => {
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) value.forEach(collectStrings);
    else if (value && typeof value === "object") {
      Object.values(value).forEach(collectStrings);
    }
  };
  collectStrings(report);
  const containsSensitiveValue = strings.some((value) =>
    sensitiveValues.some((sensitive) => sensitive && value.includes(sensitive))
  );
  const containsSensitiveLabel = strings.some((value) =>
    SENSITIVE_NOTE_PATTERN.test(value)
  );
  if (containsSensitiveValue || containsSensitiveLabel) {
    throw new Error(
      "Report sanitization rejected credentials, identifiers, Wi-Fi details, or household content"
    );
  }
}

export async function runGuidedObservations(
  report,
  { ask, isHumanInteractive, sensitiveValues = [], onTransition }
) {
  if (!isHumanInteractive) {
    throw new Error(
      "Physical observation transitions require an interactive human terminal"
    );
  }
  for (const { name, guidance } of HUMAN_OBSERVATIONS) {
    const observation = report.hardware.observations[name];
    if (!observation || observation.status !== "pending") continue;
    const status = String(
      await ask(`${guidance}\nResult for ${name} (pass/fail/pending): `)
    )
      .trim()
      .toLowerCase();
    if (status === "pending") continue;
    if (!["pass", "fail"].includes(status)) {
      throw new Error(`${name} status must be pass, fail, or pending`);
    }
    const observedAt = String(
      await ask(
        `Enter the observation timestamp for ${name} in ISO 8601 format: `
      )
    ).trim();
    if (!observedAt || !Number.isFinite(Date.parse(observedAt))) {
      throw new Error(`${name} requires a valid observed timestamp`);
    }
    const notes = validateHumanNote(
      await ask(`Enter a concise non-sensitive observation note for ${name}: `),
      sensitiveValues
    );
    Object.assign(observation, { status, observedAt, notes });
    await onTransition?.(report);
  }
  return report;
}

export function physicalAcceptanceStatus(report) {
  if (report?.automated?.status === "fail") return "fail";
  const observations = HUMAN_OBSERVATIONS.map(
    ({ name }) => report?.hardware?.observations?.[name]
  );
  if (
    observations.some(
      (observation) => !observation || observation.status === "fail"
    )
  ) {
    return "fail";
  }
  return observations.every(
    (observation) =>
      observation.status === "pass" &&
      Number.isFinite(Date.parse(observation.observedAt)) &&
      observation.notes.trim().length > 0
  )
    ? "pass"
    : "pending";
}

export function acceptanceEvidencePath(path, cwd = process.cwd()) {
  const evidenceDirectory = resolve(cwd, "evidence/device-acceptance");
  const output = resolve(cwd, path);
  const child = relative(evidenceDirectory, output);
  if (
    !child ||
    child.startsWith(`..${sep}`) ||
    child === ".." ||
    isAbsolute(child) ||
    !child.endsWith(".json")
  ) {
    throw new Error(
      "Physical reports must be JSON files under evidence/device-acceptance/"
    );
  }
  return output;
}

export function buildSuccessfulIssueSummary({
  runId,
  reportPath,
  completedAt,
  firmwareIdentity,
  generation
}) {
  const safePath = relative(
    process.cwd(),
    acceptanceEvidencePath(reportPath)
  ).split(sep).join("/");
  return [
    "Physical acceptance passed.",
    `- Report: \`${safePath}\``,
    `- Run: \`${safeSummaryValue(runId, "run ID")}\``,
    `- Completed: ${safeSummaryValue(completedAt, "completion timestamp")}`,
    `- Firmware: \`${safeSummaryValue(firmwareIdentity, "firmware identity")}\``,
    `- Generation: \`${safeSummaryValue(generation, "generation")}\``
  ].join("\n");
}

export async function postSuccessfulIssueSummary(
  summaryFields,
  { runCommand }
) {
  const body = buildSuccessfulIssueSummary(summaryFields);
  const result = await runCommand(
    "gh",
    "issue",
    "comment",
    "38",
    "--body",
    body
  );
  if (result.exitCode !== 0) {
    throw new Error("Posting the physical acceptance summary failed");
  }
  return result;
}

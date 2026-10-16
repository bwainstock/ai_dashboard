import { readFile } from "node:fs/promises";

const configurationPath = process.argv[2] ?? "wrangler.toml";
const remediation =
  "Configure this field with an Email Routing-verified sender or destination address.";

function parseQuotedAssignment(line) {
  const match = line.match(/^\s*([A-Z_]+|destination_address|name)\s*=\s*"([^"]*)"\s*(?:#.*)?$/);
  return match ? [match[1], match[2]] : null;
}

function productionEmailFields(configuration) {
  let section = "";
  let emailBinding;
  const variables = new Map();

  for (const line of configuration.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "[[send_email]]") {
      section = "send_email";
      emailBinding = {};
      continue;
    }
    if (/^\[.+\]$/.test(trimmed)) {
      section = trimmed === "[vars]" ? "vars" : "";
      continue;
    }

    const assignment = parseQuotedAssignment(line);
    if (!assignment) continue;
    const [key, value] = assignment;
    if (section === "send_email" && emailBinding) {
      emailBinding[key] = value;
    } else if (section === "vars") {
      variables.set(key, value);
    }
  }

  return {
    "INCIDENT_EMAIL.destination_address":
      emailBinding?.name === "INCIDENT_EMAIL"
        ? emailBinding.destination_address
        : undefined,
    OPERATIONAL_EMAIL_FROM: variables.get("OPERATIONAL_EMAIL_FROM"),
    OPERATIONAL_EMAIL_TO: variables.get("OPERATIONAL_EMAIL_TO")
  };
}

function isEmailAddress(value) {
  return /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/.test(value);
}

function isPlaceholderAddress(value) {
  const domain = value.slice(value.lastIndexOf("@") + 1).toLowerCase();
  return (
    domain === "localhost" ||
    domain === "example.com" ||
    domain === "example.org" ||
    domain === "example.net" ||
    domain.endsWith(".example") ||
    domain.endsWith(".invalid") ||
    domain.endsWith(".test")
  );
}

let configuration;
try {
  configuration = await readFile(configurationPath, "utf8");
} catch {
  console.error(`Production configuration validation failed: cannot read ${configurationPath}.`);
  process.exit(1);
}

const fields = productionEmailFields(configuration);
const errors = [];
for (const [field, value] of Object.entries(fields)) {
  if (!value) {
    errors.push(`${field} is missing. ${remediation}`);
  } else if (!isEmailAddress(value) || isPlaceholderAddress(value)) {
    errors.push(`${field} is not a deployable email address. ${remediation}`);
  }
}

if (
  fields["INCIDENT_EMAIL.destination_address"] &&
  fields.OPERATIONAL_EMAIL_TO &&
  fields["INCIDENT_EMAIL.destination_address"] !== fields.OPERATIONAL_EMAIL_TO
) {
  errors.push(
    "OPERATIONAL_EMAIL_TO must match INCIDENT_EMAIL.destination_address so the constrained binding can deliver it. Configure both fields with the same Email Routing-verified destination address."
  );
}

if (errors.length > 0) {
  console.error(`Production configuration validation failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Production email configuration is valid.");

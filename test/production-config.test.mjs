import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { describe, expect, test } from "vitest";

const VALIDATOR = new URL(
  "../scripts/validate-production-config.mjs",
  import.meta.url
);

function validate(fixture) {
  return spawnSync(
    process.execPath,
    [VALIDATOR.pathname, new URL(`fixtures/production-config/${fixture}`, import.meta.url).pathname],
    { encoding: "utf8" }
  );
}

describe("production configuration validation", () => {
  test.each([
    ["missing-from.toml", "OPERATIONAL_EMAIL_FROM"],
    ["missing-to.toml", "OPERATIONAL_EMAIL_TO"],
    ["missing-binding-destination.toml", "INCIDENT_EMAIL.destination_address"]
  ])("rejects missing required email configuration in %s", (fixture, field) => {
    const result = validate(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(field);
    expect(result.stderr).toContain("Email Routing-verified");
  });

  test.each([
    ["placeholder-from.toml", "OPERATIONAL_EMAIL_FROM", "dashboard@example.com"],
    ["placeholder-to.toml", "OPERATIONAL_EMAIL_TO", "operator@example.org"],
    [
      "placeholder-binding-destination.toml",
      "INCIDENT_EMAIL.destination_address",
      "operator@example.net"
    ]
  ])("rejects placeholder email configuration in %s", (fixture, field, value) => {
    const result = validate(fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(field);
    expect(result.stderr).toContain("Email Routing-verified");
    expect(result.stderr).not.toContain(value);
  });

  test("accepts non-placeholder production configuration locally", () => {
    const result = validate("valid.toml");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production email configuration is valid.");
    expect(result.stderr).toBe("");
  });

  test("rejects a destination that does not match the constrained email binding", () => {
    const result = validate("mismatched-destination.toml");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("OPERATIONAL_EMAIL_TO");
    expect(result.stderr).toContain("INCIDENT_EMAIL.destination_address");
    expect(result.stderr).not.toContain("operator@household.dev");
    expect(result.stderr).not.toContain("alerts@household.dev");
  });

  test("the repository check validates production configuration first", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    );

    expect(packageJson.scripts["validate:production-config"]).toBe(
      "node scripts/validate-production-config.mjs wrangler.toml"
    );
    expect(packageJson.scripts.check.startsWith(
      "npm run validate:production-config && "
    )).toBe(true);
  });
});

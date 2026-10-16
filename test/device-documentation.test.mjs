import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const CONTRACT_URL = new URL(
  "../docs/device-client-contract.md",
  import.meta.url
);

test("the canonical device contract covers every production responsibility", async () => {
  const contract = await readFile(CONTRACT_URL, "utf8");

  for (const heading of [
    "## Protocol",
    "## Complete-generation caching",
    "## Local navigation",
    "## Refresh behavior",
    "## Deployment",
    "## Maintenance",
    "## Physical acceptance",
  ]) {
    assert.match(contract, new RegExp(`^${heading}$`, "m"));
  }

  assert.match(contract, /Daily Brief/);
  assert.match(contract, /Calendar View/);
  assert.match(contract, /one debounced Key 3 press/i);
  assert.match(contract, /no Worker request/i);
});

test("living design documentation records the accepted renderer decisions", async () => {
  const design = await readFile(
    new URL("../docs/design.md", import.meta.url),
    "utf8"
  );

  assert.match(design, /native\s+800x480 scale/i);
  assert.match(design, /fixed monochrome threshold/i);
  assert.match(design, /heavy sans/i);
  assert.match(design, /at least 14px/i);
  assert.doesNotMatch(design, /2x device scale/i);
  assert.doesNotMatch(design, /at least 12px/i);
});

test("agents and historical ticket specifications point to the living contract", async () => {
  const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
  assert.match(
    agents,
    /For ESPHome or device-protocol work, read `docs\/device-client-contract\.md`\./
  );

  const acceptanceDirectory = new URL("../docs/acceptance/", import.meta.url);
  const ticketDocuments = (await readdir(acceptanceDirectory)).filter((name) =>
    /^ticket-.*\.md$/.test(name)
  );
  assert.ok(ticketDocuments.length > 0);

  for (const name of ticketDocuments) {
    const document = await readFile(new URL(name, acceptanceDirectory), "utf8");
    assert.match(
      document,
      /^> \[!NOTE\]\n> Historical ticket specification\./m,
      name
    );
    assert.match(document, /\.\.\/device-client-contract\.md/, name);
  }
});

test("the living-documentation check rejects obsolete production behavior", () => {
  const script = new URL(
    "../scripts/check-device-documentation.mjs",
    import.meta.url
  );
  const clean = new URL(
    "fixtures/device-documentation/current.md",
    import.meta.url
  );
  const obsolete = new URL(
    "fixtures/device-documentation/obsolete.md",
    import.meta.url
  );

  const accepted = spawnSync(
    process.execPath,
    [fileURLToPath(script), fileURLToPath(clean)],
    { encoding: "utf8" }
  );
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = spawnSync(
    process.execPath,
    [fileURLToPath(script), fileURLToPath(obsolete)],
    { encoding: "utf8" }
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /obsolete\.md:3/);
  assert.match(rejected.stderr, /double-click/i);
  assert.match(rejected.stderr, /obsolete\.md:4/);
  assert.match(rejected.stderr, /server-managed cursor/i);
});

test("the normal repository check includes living device documentation", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  );

  assert.match(packageJson.scripts.check, /check:device-documentation/);
  assert.equal(
    packageJson.scripts["check:device-documentation"],
    "node scripts/check-device-documentation.mjs"
  );
});

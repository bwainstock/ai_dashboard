import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const diagnosticConfigUrl = new URL(
  "../esphome/trmnl-four-gray-diagnostic.yaml",
  import.meta.url,
);
const productionConfigUrl = new URL(
  "../esphome/trmnl-daily-brief.yaml",
  import.meta.url,
);
const packageUrl = new URL("../package.json", import.meta.url);
const acceptanceUrl = new URL(
  "../docs/acceptance/ticket-48-four-gray-prototype.md",
  import.meta.url,
);

test("four-gray diagnostic pins the LUT-backed adapter and production hardware", async () => {
  const config = await readFile(diagnosticConfigUrl, "utf8");

  assert.match(config, /url:\s*https:\/\/github\.com\/parkghost\/esphome-epaper/);
  assert.match(
    config,
    /ref:\s*cf145a72d835a5ef0b66576a5945bc7f16f232c0/,
  );
  assert.match(config, /components:\s*\[epaper_spi\]/);
  assert.match(config, /refresh:\s*never/);
  assert.match(config, /board:\s*esp32-s3-devkitc-1/);
  assert.match(config, /clk_pin:\s*GPIO7/);
  assert.match(config, /mosi_pin:\s*GPIO9/);
  assert.match(config, /platform:\s*epaper_spi/);
  assert.match(config, /model:\s*gdey075t7-gray4-lut/);
  assert.match(config, /cs_pin:\s*GPIO44/);
  assert.match(config, /dc_pin:\s*GPIO10/);
  assert.match(config, /reset_pin:\s*GPIO38/);
  assert.match(config, /busy_pin:\s*GPIO4/);
  assert.doesNotMatch(config, /busy_pin:[\s\S]{0,80}inverted:\s*true/);
});

test("four-gray diagnostic renders each supported luminance and reports headroom", async () => {
  const config = await readFile(diagnosticConfigUrl, "utf8");

  for (const level of [0, 85, 170, 255]) {
    assert.match(
      config,
      new RegExp(`Color\\(${level},\\s*${level},\\s*${level}\\)`),
    );
  }
  assert.match(config, /filled_rectangle/);
  assert.match(config, /ESP\.getFreePsram\(\)/);
  assert.match(config, /Four-gray diagnostic PSRAM headroom/);
  assert.match(config, /update_interval:\s*never/);
});

test("prototype leaves the production monochrome rendering contract unchanged", async () => {
  const config = await readFile(productionConfigUrl, "utf8");

  assert.match(config, /platform:\s*waveshare_epaper/);
  assert.match(config, /model:\s*7\.50inv2/);
  assert.match(config, /type:\s*BINARY/);
  assert.doesNotMatch(config, /external_components|epaper_spi|GRAY4|GRAYSCALE/);
});

test("repository scripts compile diagnostic and rollback with the pinned ESPHome release", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));

  assert.equal(
    packageJson.scripts["esphome:compile"],
    "uvx --from esphome==2026.9.1 esphome compile esphome/trmnl-daily-brief.yaml",
  );
  assert.equal(
    packageJson.scripts["esphome:compile:gray4"],
    "uvx --from esphome==2026.9.1 esphome compile esphome/trmnl-four-gray-diagnostic.yaml",
  );
  assert.equal(
    packageJson.scripts["esphome:compile:rollback"],
    "npm run esphome:compile",
  );
});

test("physical acceptance procedure records required observations without inventing results", async () => {
  const acceptance = await readFile(acceptanceUrl, "utf8");

  assert.match(acceptance, /cf145a72d835a5ef0b66576a5945bc7f16f232c0/);
  assert.match(acceptance, /gdey075t7-gray4-lut/);
  assert.match(acceptance, /npm run esphome:compile:gray4/);
  assert.match(acceptance, /npm run esphome:compile:rollback/);
  assert.match(acceptance, /device-acceptance-report\.schema\.json/);
  assert.match(acceptance, /"fourGrayPrototype":\s*\{/);
  assert.match(acceptance, /npm run acceptance:validate --/);
  assert.match(acceptance, /do not open the enclosure solely/i);
  assert.doesNotMatch(acceptance, /panelMarking/);
  assert.match(acceptance, /four visibly distinct/i);
  assert.match(acceptance, /refresh duration/i);
  assert.match(acceptance, /ghosting/i);
  assert.match(acceptance, /PSRAM headroom/i);
  assert.match(acceptance, /busy polarity/i);
  assert.doesNotMatch(acceptance, /^- Status:/m);
});

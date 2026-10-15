import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const configUrl = new URL(
  "../esphome/trmnl-daily-brief.yaml",
  import.meta.url,
);

test("ESPHome Daily Brief targets the Seeed TRMNL OG kit", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /board:\s*esp32-s3-devkitc-1/);
  assert.match(config, /clk_pin:\s*GPIO7/);
  assert.match(config, /mosi_pin:\s*GPIO9/);
  assert.match(config, /model:\s*7\.50inv2/);
  assert.match(config, /cs_pin:\s*GPIO44/);
  assert.match(config, /dc_pin:\s*GPIO10/);
  assert.match(config, /reset_pin:\s*GPIO38/);
  assert.match(config, /number:\s*GPIO4/);
  assert.match(config, /inverted:\s*true/);
});

test("ESPHome Daily Brief updates only after a validated private image", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /Update-Source:\s*timer/);
  assert.match(config, /ID:\s*!secret device_id/);
  assert.match(config, /Access-Token:\s*!secret device_token/);
  assert.match(config, /follow_redirects:\s*false/);
  assert.match(config, /json::parse_json/);
  assert.match(config, /image_url != expected_image_url/);
  assert.match(config, /refresh_rate < 1 \|\| refresh_rate > 86400/);
  assert.match(config, /type:\s*BINARY/);
  assert.match(config, /resize:\s*800x480/);
  assert.match(config, /on_download_finished:/);
  assert.match(config, /component\.update:\s*main_display/);
  assert.match(config, /deep_sleep\.enter:/);
  assert.match(config, /on_error:/);
});

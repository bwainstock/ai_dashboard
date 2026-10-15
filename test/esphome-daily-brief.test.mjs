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

  assert.match(config, /Update-Source:\s*!lambda/);
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

test("ESPHome maps bright PNG pixels to white e-paper pixels", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(
    config,
    /it\.image\(0,\s*0,\s*id\(dashboard_image\),\s*COLOR_OFF,\s*COLOR_ON\)/,
  );
});

test("Key 3 double-click requests one server-managed button navigation", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /id:\s*key3/);
  assert.match(config, /number:\s*GPIO5/);
  assert.match(config, /wakeup_pin_mode:\s*KEEP_AWAKE/);
  assert.match(config, /esp_sleep_get_wakeup_cause\(\)/);
  assert.match(
    config,
    /id\(update_source\)\s*=\s*id\(button_wake\)\s*\?\s*"button"\s*:\s*"timer"/,
  );
  assert.match(config, /Update-Source:\s*!lambda/);
  assert.match(config, /return id\(update_source\)\.c_str\(\);/);
  assert.match(config, /delayed_on:\s*30ms/);
  assert.match(config, /delayed_off:\s*30ms/);
  assert.match(config, /delay:\s*750ms/);
  assert.match(config, /id\(button_gesture_complete\)\s*=\s*true/);
  assert.match(config, /!id\(request_started\)/);
});

test("timer wakes reset navigation without a client-side view cursor", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /initial_value:\s*'"timer"'/);
  assert.doesNotMatch(config, /page_index|view_cursor|current_view/);
  assert.doesNotMatch(config, /weather|calendar.*refresh|generate/i);
});

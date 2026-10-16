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

test("ESPHome Daily Brief downloads one authenticated private image", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /Update-Source:\s*!lambda/);
  assert.match(config, /ID:\s*!secret device_id/);
  assert.match(config, /Access-Token:\s*!secret device_token/);
  assert.match(config, /follow_redirects:\s*false/);
  assert.match(config, /url:\s*"\$\{device_origin\}\/api\/image"/);
  assert.match(config, /type:\s*BINARY/);
  assert.match(config, /resize:\s*800x480/);
  assert.match(config, /on_download_finished:/);
  assert.match(config, /component\.update:\s*main_display/);
  assert.match(config, /on_error:/);
  assert.doesNotMatch(config, /\/api\/display|json::parse_json|image_url/);
  assert.doesNotMatch(config, /deep_sleep:/);
});

test("ESPHome maps bright PNG pixels to white e-paper pixels", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(
    config,
    /it\.image\(0,\s*0,\s*id\(dashboard_image\),\s*COLOR_OFF,\s*COLOR_ON\)/,
  );
});

test("XIAO user LED reports download, refresh, error, and idle states", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /id:\s*status_led/);
  assert.match(config, /number:\s*GPIO21/);
  assert.match(config, /id:\s*status_led_fast_blink[\s\S]*delay:\s*100ms/);
  assert.match(config, /id:\s*status_led_error[\s\S]*count:\s*3/);
  assert.match(
    config,
    /script\.execute:\s*status_led_refreshing[\s\S]*component\.update:\s*main_display/,
  );
  assert.match(config, /script\.execute:\s*status_led_awake/);
});

test("Key 3 double-click requests one server-managed button navigation", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /id:\s*key3/);
  assert.match(config, /number:\s*GPIO5/);
  assert.match(config, /Update-Source:\s*!lambda/);
  assert.match(config, /return id\(update_source\)\.c_str\(\);/);
  assert.match(config, /delayed_on:\s*30ms/);
  assert.match(config, /delayed_off:\s*30ms/);
  assert.match(config, /delay:\s*750ms/);
  assert.match(config, /id\(button_gesture_complete\)\s*=\s*true/);
  assert.match(config, /id\(update_source\)\s*=\s*"button"/);
  assert.match(config, /!id\(request_started\)/);
});

test("timer wakes reset navigation without a client-side view cursor", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /initial_value:\s*'"timer"'/);
  assert.doesNotMatch(config, /page_index|view_cursor|current_view/);
  assert.doesNotMatch(config, /weather|calendar.*refresh|generate/i);
});

test("local scheduling refreshes after each server generation", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /platform:\s*sntp/);
  assert.match(config, /timezone:\s*America\/Los_Angeles/);
  assert.match(config, /minutes:\s*32[\s\S]*hours:\s*6,10/);
  assert.match(config, /minutes:\s*2[\s\S]*hours:\s*15,19/);
  assert.match(config, /id:\s*scheduled_image_refresh/);
});

test("Key 1 maintenance mode keeps the device available for serial logs and OTA", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /id:\s*key1/);
  assert.match(config, /number:\s*GPIO2/);
  assert.match(config, /pinMode\(2,\s*INPUT_PULLUP\)/);
  assert.match(config, /id\(maintenance_mode\)\s*=\s*digitalRead\(2\)\s*==\s*LOW/);
  assert.match(config, /Maintenance mode active; deep sleep is disabled/);
  assert.match(config, /Maintenance mode activated; reset to resume image updates/);
  assert.match(config, /platform:\s*esphome/);
  assert.match(config, /password:\s*!secret ota_password/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const configUrl = new URL(
  "../esphome/trmnl-daily-brief.yaml",
  import.meta.url,
);
const rollbackConfigUrl = new URL(
  "../esphome/trmnl-daily-brief-rollback.yaml",
  import.meta.url,
);
const packageUrl = new URL("../package.json", import.meta.url);
const acceptanceUrl = new URL(
  "../docs/acceptance/ticket-50-production-four-gray-device.md",
  import.meta.url,
);

test("ESPHome Daily Brief uses the accepted four-gray adapter on the production hardware", async () => {
  const config = await readFile(configUrl, "utf8");

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

test("ESPHome stages an authenticated Daily Brief and Calendar View pair", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(config, /ID:\s*!secret device_id/);
  assert.match(config, /Access-Token:\s*!secret device_token/);
  assert.match(config, /follow_redirects:\s*false/);
  assert.match(config, /url:\s*"\$\{device_origin\}\/api\/image"/);
  assert.match(config, /X-Dashboard-View:\s*daily_brief/);
  assert.match(config, /X-Dashboard-View:\s*calendar/);
  assert.match(config, /id:\s*slot_a_daily_brief/);
  assert.match(config, /id:\s*slot_a_calendar/);
  assert.match(config, /id:\s*slot_b_daily_brief/);
  assert.match(config, /id:\s*slot_b_calendar/);
  assert.equal(config.match(/type:\s*GRAYSCALE/g)?.length, 4);
  assert.doesNotMatch(config, /type:\s*BINARY/);
  assert.match(config, /resize:\s*800x480/);
  assert.match(config, /id:\s*activate_staged_view_set/);
  assert.match(config, /id\(active_slot\)\s*=\s*id\(staging_slot\)/);
  assert.match(config, /component\.update:\s*main_display/);
  assert.match(config, /on_error:/);
  assert.doesNotMatch(config, /\/api\/display|json::parse_json|image_url/);
  assert.doesNotMatch(config, /deep_sleep:/);
});

test("ESPHome renders each active grayscale image without binary color mapping", async () => {
  const config = await readFile(configUrl, "utf8");

  for (const image of [
    "slot_a_daily_brief",
    "slot_a_calendar",
    "slot_b_daily_brief",
    "slot_b_calendar",
  ]) {
    assert.match(
      config,
      new RegExp(
        `it\\.image\\(0,\\s*0,\\s*id\\(${image}\\)\\)`,
      ),
    );
  }
  assert.doesNotMatch(config, /COLOR_OFF|COLOR_ON/);
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

test("one Key 3 press switches the active cached view locally", async () => {
  const config = await readFile(configUrl, "utf8");
  const key3 = config.slice(config.indexOf("id: key3"));

  assert.match(key3, /number:\s*GPIO5/);
  assert.match(key3, /delayed_on:\s*30ms/);
  assert.match(key3, /delayed_off:\s*30ms/);
  assert.match(key3, /id\(selected_view\)\s*=\s*1\s*-\s*id\(selected_view\)/);
  assert.match(key3, /component\.update:\s*main_display/);
  assert.doesNotMatch(key3, /http_request|component\.update:\s*slot_/);
  assert.doesNotMatch(config, /button_click_window|button_armed|button_gesture_complete|750ms/);
});

test("scheduled refresh resets to Daily Brief before refreshing the complete pair", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.match(
    config,
    /id:\s*scheduled_image_refresh[\s\S]*id\(selected_view\)\s*=\s*0[\s\S]*script\.execute:\s*request_view_set_if_ready/,
  );
  assert.match(config, /X-Dashboard-Metadata:\s*"true"/);
  assert.match(config, /If-None-Match:\s*!lambda/);
  assert.match(config, /response->status_code\s*==\s*304/);
  assert.match(config, /id\(reset_display_to_daily\)/);
  assert.match(
    config,
    /id:\s*finish_unchanged_view_set[\s\S]*component\.update:\s*main_display/,
  );
});

test("partial staging failure preserves the active pair", async () => {
  const config = await readFile(configUrl, "utf8");
  const failureScript = config.slice(
    config.indexOf("id: handle_update_failure"),
    config.indexOf("\nimage:"),
  );

  assert.match(config, /id\(staging_slot\)\s*=\s*1\s*-\s*id\(active_slot\)/);
  assert.match(config, /View-set metadata is incomplete or mixed-generation/);
  assert.doesNotMatch(failureScript, /active_slot|active_daily_etag|active_calendar_etag/);
  assert.match(failureScript, /online_image\.release:\s*slot_a_daily_brief/);
  assert.match(failureScript, /online_image\.release:\s*slot_b_daily_brief/);
  assert.match(config, /ESP\.getFreePsram\(\)/);
});

test("mixed 200 and 304 metadata still stages the complete generation", async () => {
  const config = await readFile(configUrl, "utf8");

  assert.doesNotMatch(
    config,
    /calendar_status\s*==\s*id\(daily_metadata_status\)/,
  );
  assert.match(
    config,
    /id\(daily_metadata_status\)\s*==\s*304\s*&&[\s\S]*response->status_code\s*==\s*304/,
  );
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

test("repository scripts compile production grayscale and the frozen monochrome rollback", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const rollback = await readFile(rollbackConfigUrl, "utf8");

  assert.equal(
    packageJson.scripts["esphome:compile"],
    "uvx --from esphome==2026.9.1 esphome compile esphome/trmnl-daily-brief.yaml",
  );
  assert.equal(
    packageJson.scripts["esphome:compile:rollback"],
    "uvx --from esphome==2026.9.1 esphome compile esphome/trmnl-daily-brief-rollback.yaml",
  );
  assert.match(rollback, /platform:\s*waveshare_epaper/);
  assert.match(rollback, /model:\s*7\.50inv2/);
  assert.match(rollback, /type:\s*BINARY/);
  assert.doesNotMatch(
    rollback,
    /external_components|epaper_spi|gdey075t7-gray4-lut|type:\s*GRAYSCALE/,
  );
});

test("production device documentation records accepted hardware evidence and rollback", async () => {
  const acceptance = await readFile(acceptanceUrl, "utf8");

  assert.match(acceptance, /cf145a72d835a5ef0b66576a5945bc7f16f232c0/);
  assert.match(acceptance, /gdey075t7-gray4-lut/);
  assert.match(acceptance, /3437 ms/);
  assert.match(acceptance, /8,289,824 bytes/);
  assert.match(acceptance, /8,087,608 bytes/);
  assert.match(acceptance, /4a8d526c4202095fe2abaf3e5a310199e23da589/);
  assert.match(acceptance, /npm run esphome:compile/);
  assert.match(acceptance, /npm run esphome:compile:rollback/);
});

import { downloadByosDisplay } from "./byos-manifest-lib.mjs";

const [baseUrl, wakeSource = "timer"] = process.argv.slice(2);
const deviceId = process.env.DEVICE_ID;
const accessToken = process.env.DEVICE_TOKEN;

if (!baseUrl || !deviceId || !accessToken) {
  console.error(
    "Usage: DEVICE_ID=... DEVICE_TOKEN=... npm run acceptance:rollback-byos-manifest -- https://dashboard-device.example.com [timer|scheduled|powercycle|unknown|button]"
  );
  process.exit(2);
}

const display = await downloadByosDisplay({
  deviceOrigin: baseUrl,
  deviceId,
  accessToken,
  wakeSource
});

console.log(
  JSON.stringify(
    {
      filename: display.filename,
      refresh_rate: display.refreshRateSeconds,
      image_bytes: display.imageBytes.byteLength,
      media_type: display.contentType
    },
    null,
    2
  )
);

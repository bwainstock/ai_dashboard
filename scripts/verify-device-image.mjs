import { PNG } from "pngjs";
import {
  requestByosManifest,
  requestPrivatePng
} from "./byos-manifest-lib.mjs";

const [baseUrl] = process.argv.slice(2);
const deviceId = process.env.DEVICE_ID;
const token = process.env.DEVICE_TOKEN;
const maximumBytes = Number(process.env.MAX_IMAGE_BYTES ?? 1_000_000);

if (!baseUrl || !deviceId || !token) {
  console.error(
    "Usage: DEVICE_ID=... DEVICE_TOKEN=... npm run acceptance:device -- https://dashboard-device.example.com"
  );
  process.exit(2);
}

const display = await requestByosManifest({
  deviceOrigin: baseUrl,
  deviceId,
  accessToken: token
});
const imageResponse = await requestPrivatePng({
  imageUrl: display.imageUrl,
  deviceId,
  accessToken: token
});

const bytes = Buffer.from(await imageResponse.arrayBuffer());
if (bytes.byteLength > maximumBytes) {
  throw new Error(
    `Image is ${bytes.byteLength} bytes; limit is ${maximumBytes} bytes`
  );
}

const png = PNG.sync.read(bytes);
if (png.width !== 800 || png.height !== 480) {
  throw new Error(`Image is ${png.width}x${png.height}; expected 800x480`);
}

for (let offset = 0; offset < png.data.length; offset += 4) {
  if (
    png.data[offset] !== png.data[offset + 1] ||
    png.data[offset + 1] !== png.data[offset + 2] ||
    png.data[offset + 3] !== 255
  ) {
    throw new Error("Image contains a non-monochrome or transparent pixel");
  }
}

console.log(
  JSON.stringify(
    {
      filename: display.filename,
      byte_size: bytes.byteLength,
      dimensions: `${png.width}x${png.height}`,
      monochrome: true,
      media_type: imageResponse.headers.get("content-type")
    },
    null,
    2
  )
);

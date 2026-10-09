import { PNG } from "pngjs";

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

const headers = { ID: deviceId, "Access-Token": token };
const displayResponse = await fetch(new URL("/api/display", baseUrl), {
  headers
});
if (!displayResponse.ok) {
  throw new Error(
    `Display request failed (${displayResponse.status}): ${await displayResponse.text()}`
  );
}

const display = await displayResponse.json();
if (
  display.status !== 0 ||
  typeof display.image_url !== "string" ||
  typeof display.filename !== "string"
) {
  throw new Error("Display response does not contain a published image");
}
if (new URL(display.image_url).origin !== new URL(baseUrl).origin) {
  throw new Error("Display response points outside the private device origin");
}

const imageResponse = await fetch(display.image_url, { headers });
if (!imageResponse.ok) {
  throw new Error(`Image request failed (${imageResponse.status})`);
}
if (imageResponse.headers.get("content-type") !== "image/png") {
  throw new Error("Image response is not image/png");
}

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

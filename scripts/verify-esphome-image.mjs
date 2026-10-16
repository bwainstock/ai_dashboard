import { PNG } from "pngjs";

const [baseUrl, wakeSource = "timer"] = process.argv.slice(2);
const deviceId = process.env.DEVICE_ID;
const accessToken = process.env.DEVICE_TOKEN;

if (!baseUrl || !deviceId || !accessToken) {
  console.error(
    "Usage: DEVICE_ID=... DEVICE_TOKEN=... npm run acceptance:rollback-esphome-cursor -- https://dashboard-device.example.com [timer|button]"
  );
  process.exit(2);
}

const imageUrl = new URL("/api/image", baseUrl);
const headers = {
  ID: deviceId,
  "Access-Token": accessToken,
  "Update-Source": wakeSource,
  Accept: "image/png"
};
const response = await fetch(imageUrl, {
  headers,
  redirect: "manual"
});
if (!response.ok || response.headers.get("content-type") !== "image/png") {
  throw new Error(`Direct image request failed with HTTP ${response.status}`);
}

const bytes = Buffer.from(await response.arrayBuffer());
const png = PNG.sync.read(bytes);
if (png.width !== 800 || png.height !== 480) {
  throw new Error(`Image is ${png.width}x${png.height}; expected 800x480`);
}
for (let offset = 0; offset < png.data.length; offset += 4) {
  const value = png.data[offset];
  if (
    value !== png.data[offset + 1] ||
    value !== png.data[offset + 2] ||
    (value !== 0 && value !== 255) ||
    png.data[offset + 3] !== 255
  ) {
    throw new Error("Image is not an opaque 1-bit black-and-white PNG");
  }
}

const etag = response.headers.get("etag");
if (!etag) throw new Error("Direct image response is missing an ETag");
let etagRevalidation = false;
if (wakeSource === "timer") {
  const cached = await fetch(imageUrl, {
    headers: { ...headers, "If-None-Match": etag },
    redirect: "manual"
  });
  if (cached.status !== 304) {
    throw new Error(`ETag revalidation returned HTTP ${cached.status}`);
  }
  etagRevalidation = true;
}

console.log(
  JSON.stringify(
    {
      filename: response.headers.get("x-dashboard-filename"),
      generation: response.headers.get("x-dashboard-generation"),
      view: response.headers.get("x-dashboard-view"),
      image_bytes: bytes.byteLength,
      dimensions: `${png.width}x${png.height}`,
      palette: "1-bit",
      etag_revalidation: etagRevalidation
    },
    null,
    2
  )
);

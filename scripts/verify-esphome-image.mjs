import { PNG } from "pngjs";

const [baseUrl] = process.argv.slice(2);
const deviceId = process.env.DEVICE_ID;
const accessToken = process.env.DEVICE_TOKEN;

if (!baseUrl || !deviceId || !accessToken) {
  console.error(
    "Usage: DEVICE_ID=... DEVICE_TOKEN=... npm run acceptance:esphome-image -- https://dashboard-device.example.com [timer|button]"
  );
  process.exit(2);
}

const imageUrl = new URL("/api/image", baseUrl);
const authenticationHeaders = {
  ID: deviceId,
  "Access-Token": accessToken,
  Accept: "image/png"
};

async function requestView(view, extraHeaders = {}) {
  return fetch(imageUrl, {
    headers: {
      ...authenticationHeaders,
      "X-Dashboard-View": view,
      ...extraHeaders
    },
    redirect: "manual"
  });
}

async function validateView(view) {
  const response = await requestView(view);
  if (!response.ok || response.headers.get("content-type") !== "image/png") {
    throw new Error(`${view} image request failed with HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const png = PNG.sync.read(bytes);
  if (png.width !== 800 || png.height !== 480) {
    throw new Error(`${view} image is ${png.width}x${png.height}; expected 800x480`);
  }
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const value = png.data[offset];
    if (
      value !== png.data[offset + 1] ||
      value !== png.data[offset + 2] ||
      (value !== 0 && value !== 255) ||
      png.data[offset + 3] !== 255
    ) {
      throw new Error(`${view} image is not an opaque 1-bit black-and-white PNG`);
    }
  }

  const etag = response.headers.get("etag");
  const generation = response.headers.get("x-dashboard-generation");
  if (!etag || !generation) {
    throw new Error(`${view} response is missing cache or generation headers`);
  }
  const cached = await requestView(view, {
    "X-Dashboard-Metadata": "true",
    "If-None-Match": etag
  });
  if (cached.status !== 304) {
    throw new Error(`${view} ETag revalidation returned HTTP ${cached.status}`);
  }
  return {
    filename: response.headers.get("x-dashboard-filename"),
    generation,
    view: response.headers.get("x-dashboard-view"),
    image_bytes: bytes.byteLength,
    dimensions: `${png.width}x${png.height}`,
    palette: "1-bit",
    etag_revalidation: true
  };
}

const views = await Promise.all([
  validateView("daily_brief"),
  validateView("calendar")
]);
if (views[0].generation !== views[1].generation) {
  throw new Error("Daily Brief and Calendar View belong to different generations");
}

console.log(
  JSON.stringify(
    {
      generation: views[0].generation,
      views
    },
    null,
    2
  )
);

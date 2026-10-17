import { PNG } from "pngjs";
import {
  FOUR_GRAY_PNG_CONTRACT,
  isFourGrayLuminance
} from "../shared/four-gray-contract.mjs";
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
if (
  png.width !== FOUR_GRAY_PNG_CONTRACT.width ||
  png.height !== FOUR_GRAY_PNG_CONTRACT.height
) {
  throw new Error(
    `Image is ${png.width}x${png.height}; expected ${FOUR_GRAY_PNG_CONTRACT.width}x${FOUR_GRAY_PNG_CONTRACT.height}`
  );
}

for (let offset = 0; offset < png.data.length; offset += 4) {
  if (
    png.data[offset] !== png.data[offset + 1] ||
    png.data[offset + 1] !== png.data[offset + 2] ||
    !isFourGrayLuminance(png.data[offset]) ||
    png.data[offset + 3] !== FOUR_GRAY_PNG_CONTRACT.opaqueAlpha
  ) {
    throw new Error(
      "Image contains color, transparency, or pixels outside the four-gray palette"
    );
  }
}

console.log(
  JSON.stringify(
    {
      filename: display.filename,
      byte_size: bytes.byteLength,
      dimensions: `${png.width}x${png.height}`,
      palette: "four-gray",
      media_type: imageResponse.headers.get("content-type")
    },
    null,
    2
  )
);

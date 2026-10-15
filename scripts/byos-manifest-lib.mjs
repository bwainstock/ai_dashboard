export const MAX_REFRESH_RATE_SECONDS = 86_400;
const WAKE_SOURCES = new Set([
  "timer",
  "scheduled",
  "powercycle",
  "unknown",
  "button"
]);

export function parseByosManifest(value, deviceOrigin) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Display manifest must be a JSON object");
  }
  if (value.status !== 0) {
    throw new Error("Display manifest status is not successful");
  }
  if (
    typeof value.image_url !== "string" ||
    typeof value.filename !== "string" ||
    value.filename.length === 0
  ) {
    throw new Error("Display manifest is missing its image identity");
  }
  if (
    !Number.isInteger(value.refresh_rate) ||
    value.refresh_rate <= 0 ||
    value.refresh_rate > MAX_REFRESH_RATE_SECONDS
  ) {
    throw new Error("Display manifest refresh rate is outside the safe range");
  }

  const configuredOrigin = new URL(deviceOrigin).origin;
  const imageUrl = new URL(value.image_url);
  if (
    imageUrl.origin !== configuredOrigin ||
    imageUrl.username ||
    imageUrl.password
  ) {
    throw new Error("Display manifest image URL is outside the device origin");
  }
  const pathFilename = decodeURIComponent(
    imageUrl.pathname.slice(imageUrl.pathname.lastIndexOf("/") + 1)
  );
  if (pathFilename !== value.filename) {
    throw new Error("Display manifest filename does not match its image URL");
  }

  return {
    imageUrl: imageUrl.href,
    filename: value.filename,
    refreshRateSeconds: value.refresh_rate
  };
}

export async function downloadByosDisplay({
  deviceOrigin,
  deviceId,
  accessToken,
  wakeSource,
  fetchImpl = fetch
}) {
  if (!deviceId || !accessToken) {
    throw new Error("Device credentials are required");
  }
  if (!WAKE_SOURCES.has(wakeSource)) {
    throw new Error("Unsupported wake source");
  }

  const origin = new URL(deviceOrigin).origin;
  const credentials = { ID: deviceId, "Access-Token": accessToken };
  const manifestResponse = await fetchImpl(new URL("/api/display", origin), {
    headers: { ...credentials, "Update-Source": wakeSource },
    redirect: "manual"
  });
  if (!manifestResponse.ok) {
    throw new Error(`Display request failed with ${manifestResponse.status}`);
  }
  const manifest = parseByosManifest(await manifestResponse.json(), origin);
  const imageResponse = await fetchImpl(manifest.imageUrl, {
    headers: credentials,
    redirect: "manual"
  });
  if (!imageResponse.ok) {
    throw new Error(`Image request failed with ${imageResponse.status}`);
  }
  const contentType = imageResponse.headers.get("content-type");
  if (contentType !== "image/png") {
    throw new Error("Image response is not image/png");
  }

  return {
    ...manifest,
    contentType,
    imageBytes: new Uint8Array(await imageResponse.arrayBuffer())
  };
}

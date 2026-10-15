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
  const expectedImageUrl = new URL(
    `/images/${encodeURIComponent(value.filename)}`,
    configuredOrigin
  );
  if (
    imageUrl.origin !== configuredOrigin ||
    imageUrl.username ||
    imageUrl.password ||
    imageUrl.href !== expectedImageUrl.href
  ) {
    throw new Error(
      "Display manifest image URL does not match the private image route"
    );
  }

  return {
    imageUrl: imageUrl.href,
    filename: value.filename,
    refreshRateSeconds: value.refresh_rate
  };
}

function deviceCredentials(deviceId, accessToken) {
  if (!deviceId || !accessToken) {
    throw new Error("Device credentials are required");
  }
  return { ID: deviceId, "Access-Token": accessToken };
}

export async function requestByosManifest({
  deviceOrigin,
  deviceId,
  accessToken,
  wakeSource,
  fetchImpl = fetch
}) {
  if (wakeSource !== undefined && !WAKE_SOURCES.has(wakeSource)) {
    throw new Error("Unsupported wake source");
  }

  const origin = new URL(deviceOrigin).origin;
  const credentials = deviceCredentials(deviceId, accessToken);
  const manifestResponse = await fetchImpl(new URL("/api/display", origin), {
    headers:
      wakeSource === undefined
        ? credentials
        : { ...credentials, "Update-Source": wakeSource },
    redirect: "manual"
  });
  if (!manifestResponse.ok) {
    throw new Error(`Display request failed with ${manifestResponse.status}`);
  }
  return parseByosManifest(await manifestResponse.json(), origin);
}

export async function requestPrivatePng({
  imageUrl,
  deviceId,
  accessToken,
  fetchImpl = fetch
}) {
  const imageResponse = await fetchImpl(imageUrl, {
    headers: deviceCredentials(deviceId, accessToken),
    redirect: "manual"
  });
  if (!imageResponse.ok) {
    throw new Error(`Image request failed with ${imageResponse.status}`);
  }
  const contentType = imageResponse.headers.get("content-type");
  if (contentType !== "image/png") {
    throw new Error("Image response is not image/png");
  }
  return imageResponse;
}

export async function downloadByosDisplay(options) {
  const manifest = await requestByosManifest(options);
  const imageResponse = await requestPrivatePng({
    imageUrl: manifest.imageUrl,
    deviceId: options.deviceId,
    accessToken: options.accessToken,
    fetchImpl: options.fetchImpl
  });
  return {
    ...manifest,
    contentType: imageResponse.headers.get("content-type"),
    imageBytes: new Uint8Array(await imageResponse.arrayBuffer())
  };
}

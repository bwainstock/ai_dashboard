const CALENDAR_READONLY =
  "https://www.googleapis.com/auth/calendar.readonly";
const GMAIL_READONLY = "https://www.googleapis.com/auth/gmail.readonly";

function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  return base64ToBytes(
    value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
      Math.ceil(value.length / 4) * 4,
      "="
    )
  );
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt"
  ]);
}

export function buildCalendarAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: `${CALENDAR_READONLY} ${GMAIL_READONLY}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: input.state
  }).toString();
  return url.toString();
}

export async function encryptRefreshToken(
  refreshToken: string,
  secret: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(secret),
    new TextEncoder().encode(refreshToken)
  );
  return JSON.stringify({
    version: 1,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  });
}

export async function decryptRefreshToken(
  stored: string,
  secret: string
): Promise<string> {
  const parsed = JSON.parse(stored) as {
    version: number;
    iv: string;
    ciphertext: string;
  };
  if (parsed.version !== 1) throw new Error("Unsupported token encryption");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(base64ToBytes(parsed.iv)).buffer },
    await encryptionKey(secret),
    new Uint8Array(base64ToBytes(parsed.ciphertext)).buffer
  );
  return new TextDecoder().decode(plaintext);
}

export async function createCalendarOAuthState(
  accountId: "mom" | "dad",
  secret: string,
  now = Date.now()
): Promise<string> {
  const payload = new TextEncoder().encode(
    JSON.stringify({
      accountId,
      expiresAt: now + 10 * 60_000,
      nonce: base64Url(crypto.getRandomValues(new Uint8Array(16)))
    })
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, payload)
  );
  return `${base64Url(payload)}.${base64Url(signature)}`;
}

export async function verifyCalendarOAuthState(
  state: string,
  secret: string,
  now = Date.now()
): Promise<"mom" | "dad"> {
  const [encodedPayload, encodedSignature] = state.split(".");
  if (!encodedPayload || !encodedSignature) throw new Error("Invalid OAuth state");
  const payload = fromBase64Url(encodedPayload);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      new Uint8Array(fromBase64Url(encodedSignature)).buffer,
      new Uint8Array(payload).buffer
    ))
  ) {
    throw new Error("Invalid OAuth state");
  }
  const parsed = JSON.parse(new TextDecoder().decode(payload)) as {
    accountId: string;
    expiresAt: number;
  };
  if (
    !["mom", "dad"].includes(parsed.accountId) ||
    parsed.expiresAt < now
  ) {
    throw new Error("Expired OAuth state");
  }
  return parsed.accountId as "mom" | "dad";
}

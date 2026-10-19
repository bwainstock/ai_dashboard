const MAXIMUM_REDIRECTS = 3;
const REQUEST_DEADLINE_MS = 10_000;
const MAXIMUM_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAXIMUM_DECOMPRESSED_BYTES = 10 * 1024 * 1024;

export type CalendarFeedFetchFailureCode =
  | "unsafe_url"
  | "dns_failed"
  | "unsafe_address"
  | "too_many_redirects"
  | "timeout"
  | "compressed_too_large"
  | "decompressed_too_large"
  | "unsupported_encoding"
  | "invalid_response"
  | "http_error";

export class CalendarFeedFetchError extends Error {
  constructor(public readonly code: CalendarFeedFetchFailureCode) {
    super(code);
    this.name = "CalendarFeedFetchError";
  }
}

export interface CalendarFeedFetchOptions<T> {
  fetcher: typeof fetch;
  resolveHostname(hostname: string): Promise<string[]>;
  parse(input: string): Promise<T>;
  etag?: string | null;
  lastModified?: string | null;
}

export type CalendarFeedFetchResult<T> =
  | {
      kind: "updated";
      snapshot: T;
      etag: string | null;
      lastModified: string | null;
    }
  | { kind: "unchanged" };

function safeUrl(value: string): URL {
  const url = parseCalendarFeedUrl(value);
  if (!url) throw new CalendarFeedFetchError("unsafe_url");
  return url;
}

function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part))
  ) {
    return null;
  }
  const bytes = parts.map(Number);
  return bytes.every((byte) => byte <= 255) ? bytes : null;
}

function isPublicIpv4(value: string): boolean {
  const bytes = parseIpv4(value);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  return !(
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function ipv6Hextets(value: string): number[] | null {
  const normalized = value.toLowerCase().split("%", 1)[0];
  if (!normalized.includes(":")) return null;
  const doubleColon = normalized.indexOf("::");
  if (doubleColon !== normalized.lastIndexOf("::")) return null;
  const expand = (part: string): number[] | null => {
    if (!part) return [];
    const pieces = part.split(":");
    const values: number[] = [];
    for (const piece of pieces) {
      const ipv4 = parseIpv4(piece);
      if (ipv4) {
        values.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) {
        values.push(Number.parseInt(piece, 16));
      } else {
        return null;
      }
    }
    return values;
  };
  if (doubleColon === -1) {
    const values = expand(normalized);
    return values?.length === 8 ? values : null;
  }
  const left = expand(normalized.slice(0, doubleColon));
  const right = expand(normalized.slice(doubleColon + 2));
  if (!left || !right || left.length + right.length >= 8) return null;
  return [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
}

function isPublicIpv6(value: string): boolean {
  const words = ipv6Hextets(value);
  if (!words) return false;
  const [first, second] = words;
  const isUnspecifiedOrLoopback =
    words.slice(0, 7).every((word) => word === 0) &&
    (words[7] === 0 || words[7] === 1);
  const isIpv4Mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  if (isIpv4Mapped) {
    return isPublicIpv4(
      `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
    );
  }
  return !(
    isUnspecifiedOrLoopback ||
    (first & 0xe000) !== 0x2000 ||
    (first === 0x0100 && second === 0) ||
    (first & 0xfe00) === 0xfc00 ||
    (first & 0xffc0) === 0xfe80 ||
    (first & 0xff00) === 0xff00 ||
    (first === 0x2001 && second < 0x0200) ||
    (first === 0x2001 && second === 0x0db8)
  );
}

function isPublicAddress(value: string): boolean {
  return value.includes(":") ? isPublicIpv6(value) : isPublicIpv4(value);
}

async function validateDestination(
  url: URL,
  resolveHostname: CalendarFeedFetchOptions<unknown>["resolveHostname"]
): Promise<void> {
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  const literalAddress =
    parseIpv4(literal) || ipv6Hextets(literal) ? [literal] : null;
  let addresses: string[];
  try {
    addresses = literalAddress ?? (await resolveHostname(url.hostname));
  } catch {
    throw new CalendarFeedFetchError("dns_failed");
  }
  if (addresses.length === 0) {
    throw new CalendarFeedFetchError("dns_failed");
  }
  if (addresses.some((address) => !isPublicAddress(address))) {
    throw new CalendarFeedFetchError("unsafe_address");
  }
}

async function beforeDeadline<T>(
  promise: Promise<T>,
  signal: AbortSignal
): Promise<T> {
  if (signal.aborted) throw new CalendarFeedFetchError("timeout");
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(new CalendarFeedFetchError("timeout"));
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", aborted);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", aborted);
        reject(error);
      }
    );
  });
}

async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  failureCode: "compressed_too_large" | "decompressed_too_large"
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new CalendarFeedFetchError(failureCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function responseText(response: Response): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAXIMUM_COMPRESSED_BYTES
  ) {
    throw new CalendarFeedFetchError("compressed_too_large");
  }
  const encoding = response.headers.get("content-encoding")?.toLowerCase();
  if (
    encoding &&
    encoding !== "identity" &&
    encoding !== "gzip" &&
    encoding !== "deflate"
  ) {
    throw new CalendarFeedFetchError("unsupported_encoding");
  }
  const compression =
    encoding === "gzip" || encoding === "deflate" ? encoding : null;
  const body = await readLimited(
    response.body,
    compression ? MAXIMUM_DECOMPRESSED_BYTES : MAXIMUM_COMPRESSED_BYTES,
    compression
      ? "decompressed_too_large"
      : "compressed_too_large"
  );
  let decoded = body;
  if (compression) {
    const isEncoded =
      compression === "gzip"
        ? body[0] === 0x1f && body[1] === 0x8b
        : body.length >= 2 &&
          (body[0] & 0x0f) === 8 &&
          ((body[0] << 8) + body[1]) % 31 === 0;
    if (isEncoded) {
      if (body.byteLength > MAXIMUM_COMPRESSED_BYTES) {
        throw new CalendarFeedFetchError("compressed_too_large");
      }
      try {
        const encoded = body.buffer.slice(
          body.byteOffset,
          body.byteOffset + body.byteLength
        ) as ArrayBuffer;
        decoded = await readLimited(
          new Response(encoded).body!.pipeThrough(
            new DecompressionStream(compression)
          ),
          MAXIMUM_DECOMPRESSED_BYTES,
          "decompressed_too_large"
        );
      } catch (error) {
        if (error instanceof CalendarFeedFetchError) throw error;
        throw new CalendarFeedFetchError("invalid_response");
      }
    }
  }
  if (decoded.byteLength > MAXIMUM_DECOMPRESSED_BYTES) {
    throw new CalendarFeedFetchError("decompressed_too_large");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    throw new CalendarFeedFetchError("invalid_response");
  }
}

export async function fetchCalendarFeed<T>(
  value: string,
  options: CalendarFeedFetchOptions<T>
): Promise<CalendarFeedFetchResult<T>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new CalendarFeedFetchError("timeout")),
    REQUEST_DEADLINE_MS
  );
  const headers = new Headers({
    accept: "text/calendar",
    "accept-encoding": "gzip, deflate"
  });
  if (options.etag) headers.set("if-none-match", options.etag);
  if (options.lastModified) {
    headers.set("if-modified-since", options.lastModified);
  }
  let url = safeUrl(value);
  try {
    for (let redirects = 0; ; redirects += 1) {
      await beforeDeadline(
        validateDestination(url, options.resolveHostname),
        controller.signal
      );
      let response: Response;
      try {
        response = await beforeDeadline(
          options.fetcher(url.toString(), {
            method: "GET",
            headers,
            redirect: "manual",
            signal: controller.signal
          }),
          controller.signal
        );
      } catch (error) {
        if (controller.signal.aborted) {
          throw new CalendarFeedFetchError("timeout");
        }
        throw error;
      }
      if (response.status === 304) return { kind: "unchanged" };
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= MAXIMUM_REDIRECTS) {
          throw new CalendarFeedFetchError("too_many_redirects");
        }
        const location = response.headers.get("location");
        if (!location) throw new CalendarFeedFetchError("invalid_response");
        try {
          url = safeUrl(new URL(location, url).toString());
        } catch (error) {
          if (error instanceof CalendarFeedFetchError) throw error;
          throw new CalendarFeedFetchError("unsafe_url");
        }
        continue;
      }
      if (!response.ok) throw new CalendarFeedFetchError("http_error");
      const input = await beforeDeadline(
        responseText(response),
        controller.signal
      );
      return {
        kind: "updated",
        snapshot: await beforeDeadline(options.parse(input), controller.signal),
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified")
      };
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchCalendarFeedsBounded<T, R>(
  inputs: readonly T[],
  operation: (input: T) => Promise<R>,
  concurrency = 4
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency must be a positive integer");
  }
  const results = new Array<R>(inputs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (next < inputs.length) {
        const index = next++;
        results[index] = await operation(inputs[index]);
      }
    })
  );
  return results;
}
import { parseCalendarFeedUrl } from "./calendar-feed-url";

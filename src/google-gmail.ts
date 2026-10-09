import type { GmailCandidate } from "./gmail";
import type { OperationalCode } from "./operational-codes";

type Requester = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

interface GmailMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: {
    mimeType?: string;
    headers?: Array<{ name?: string; value?: string }>;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
}

type GmailFailureCode = Extract<
  OperationalCode,
  "GMAIL_OAUTH_REVOKED" | "GMAIL_API_FAILED"
>;

type GmailFailure = Error & {
  code: GmailFailureCode;
  gmailStatus?: number;
};

function gmailFailure(status?: number): GmailFailure {
  return Object.assign(new Error("Gmail API request failed"), {
    code:
      status === 401
        ? ("GMAIL_OAUTH_REVOKED" as const)
        : ("GMAIL_API_FAILED" as const),
    ...(status === undefined ? {} : { gmailStatus: status })
  });
}

function authorized(accessToken: string): RequestInit {
  return { headers: { authorization: `Bearer ${accessToken}` } };
}

async function gmailJson<T>(
  request: Requester,
  url: URL,
  accessToken: string
): Promise<T> {
  const response = await request(url, authorized(accessToken));
  if (!response.ok) {
    throw gmailFailure(response.status);
  }
  return response.json<T>();
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  return new TextDecoder().decode(
    Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0))
  );
}

function textBody(payload: GmailMessage["payload"]): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    const value = textBody(part);
    if (value) return value;
  }
  return payload.body?.data ? decodeBase64Url(payload.body.data) : "";
}

function header(
  message: GmailMessage,
  name: string
): string | undefined {
  return message.payload?.headers?.find(
    (candidate) => candidate.name?.toLowerCase() === name.toLowerCase()
  )?.value;
}

const GMAIL_BATCH_SIZE = 40;
const GMAIL_BATCH_URL = "https://gmail.googleapis.com/batch/gmail/v1";
const GMAIL_BATCH_RETRY_DELAYS_MS = [500, 1500] as const;

function isTransientBatchFailure(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const status = (error as Partial<GmailFailure>).gmailStatus;
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function batchBody(
  ids: string[],
  start: number,
  boundary: string
): string {
  return [
    ...ids.flatMap((id, offset) => [
      `--${boundary}`,
      "Content-Type: application/http",
      `Content-ID: <item-${start + offset}>`,
      "",
      `GET /gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full HTTP/1.1`,
      ""
    ]),
    `--${boundary}--`,
    ""
  ].join("\r\n");
}

function multipartBoundary(contentType: string | null): string {
  const match = contentType?.match(
    /^multipart\/mixed\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i
  );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw gmailFailure();
  return boundary;
}

function parseHeaders(
  value: string,
  rejectDuplicates = false
): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of value.split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw gmailFailure();
    const name = line.slice(0, separator).trim().toLowerCase();
    if (rejectDuplicates && headers.has(name)) {
      throw gmailFailure();
    }
    headers.set(name, line.slice(separator + 1).trim());
  }
  return headers;
}

function parseBatchResponse(
  value: string,
  boundary: string,
  expectedIndexes: number[]
): Map<number, GmailMessage> {
  const delimiter = `--${boundary}`;
  const sections = value.split(delimiter);
  if (!/^\s*$/.test(sections[0] ?? "") || sections.at(-1)?.trim() !== "--") {
    throw gmailFailure();
  }

  const expected = new Set(expectedIndexes);
  const messages = new Map<number, GmailMessage>();
  for (const rawSection of sections.slice(1, -1)) {
    if (!rawSection.startsWith("\r\n") || !rawSection.endsWith("\r\n")) {
      throw gmailFailure();
    }
    const section = rawSection.slice(2, -2);
    const mimeSeparator = section.indexOf("\r\n\r\n");
    if (mimeSeparator < 0) {
      throw gmailFailure();
    }
    const mimeHeaders = parseHeaders(section.slice(0, mimeSeparator), true);
    if (
      mimeHeaders.get("content-type")?.toLowerCase() !== "application/http"
    ) {
      throw gmailFailure();
    }
    const contentId = mimeHeaders
      .get("content-id")
      ?.match(/^<(?:response-)?item-(\d+)>$/)?.[1];
    if (contentId === undefined) {
      throw gmailFailure();
    }
    const index = Number(contentId);
    if (!expected.has(index) || messages.has(index)) {
      throw gmailFailure();
    }

    const httpMessage = section.slice(mimeSeparator + 4);
    const statusEnd = httpMessage.indexOf("\r\n");
    if (statusEnd < 0) {
      throw gmailFailure();
    }
    const statusMatch = httpMessage
      .slice(0, statusEnd)
      .match(/^HTTP\/1\.[01] (\d{3})(?: .*)?$/);
    if (!statusMatch) throw gmailFailure();
    const status = Number(statusMatch[1]);
    if (status < 200 || status >= 300) {
      throw gmailFailure(status);
    }

    const responseHeadersEnd = httpMessage.indexOf(
      "\r\n\r\n",
      statusEnd + 2
    );
    if (responseHeadersEnd < 0) {
      throw gmailFailure();
    }
    parseHeaders(httpMessage.slice(statusEnd + 2, responseHeadersEnd));
    try {
      messages.set(
        index,
        JSON.parse(httpMessage.slice(responseHeadersEnd + 4)) as GmailMessage
      );
    } catch {
      throw gmailFailure();
    }
  }
  if (messages.size !== expected.size) {
    throw gmailFailure();
  }
  return messages;
}

async function hydrateCandidates(
  ids: string[],
  accessToken: string,
  request: Requester
): Promise<GmailCandidate[]> {
  const unique = [...new Set(ids)];
  const messages: GmailMessage[] = [];
  for (let start = 0; start < unique.length; start += GMAIL_BATCH_SIZE) {
    const batchIds = unique.slice(start, start + GMAIL_BATCH_SIZE);
    const boundary = `gmail_batch_${crypto.randomUUID()}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await request(GMAIL_BATCH_URL, {
          ...authorized(accessToken),
          method: "POST",
          headers: {
            ...authorized(accessToken).headers,
            "content-type": `multipart/mixed; boundary=${boundary}`
          },
          body: batchBody(batchIds, start, boundary)
        });
        if (!response.ok) throw gmailFailure(response.status);
        const expectedIndexes = batchIds.map((_, offset) => start + offset);
        const responseText = await response.text();
        const responseBoundary = multipartBoundary(
          response.headers.get("content-type")
        );
        const parsed = parseBatchResponse(
          responseText,
          responseBoundary,
          expectedIndexes
        );
        messages.push(
          ...expectedIndexes.map((index) => {
            const message = parsed.get(index);
            if (!message) throw gmailFailure();
            return message;
          })
        );
        break;
      } catch (error) {
        const retryDelay = GMAIL_BATCH_RETRY_DELAYS_MS[attempt];
        if (retryDelay !== undefined && isTransientBatchFailure(error)) {
          await wait(retryDelay);
          continue;
        }
        if (
          error !== null &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === "GMAIL_OAUTH_REVOKED" ||
            error.code === "GMAIL_API_FAILED")
        ) {
          throw error;
        }
        throw gmailFailure();
      }
    }
  }
  return messages.flatMap((message) => {
    try {
      return (
        !message.id || !message.threadId
          ? []
          : [
              {
                messageId: message.id,
                threadId: message.threadId,
                labelIds: message.labelIds ?? [],
                from: header(message, "From") ?? "",
                subject: header(message, "Subject") ?? "",
                body: textBody(message.payload),
                receivedAt: new Date(
                  Number(message.internalDate ?? 0)
                ).toISOString(),
                ...(header(message, "List-Unsubscribe")
                  ? {
                      listUnsubscribe: header(
                        message,
                        "List-Unsubscribe"
                      )
                    }
                  : {}),
                ...(header(message, "Precedence")
                  ? { precedence: header(message, "Precedence") }
                  : {})
              }
            ]
      );
    } catch {
      throw gmailFailure();
    }
  });
}

async function currentHistoryId(
  accessToken: string,
  request: Requester
): Promise<string> {
  const profile = await gmailJson<{ historyId?: string }>(
    request,
    new URL("https://gmail.googleapis.com/gmail/v1/users/me/profile"),
    accessToken
  );
  if (!profile.historyId) throw new Error("Gmail profile has no history ID");
  return profile.historyId;
}

export async function fetchInitialInboxCandidates(input: {
  accessToken: string;
  now: Date;
  request?: Requester;
}): Promise<{ candidates: GmailCandidate[]; historyId: string }> {
  const request = input.request ?? fetch;
  const cutoff = new Date(input.now.getTime() - 7 * 24 * 60 * 60_000);
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages"
  );
  url.searchParams.set("labelIds", "INBOX");
  url.searchParams.set(
    "q",
    `after:${cutoff.toISOString().slice(0, 10).replaceAll("-", "/")}`
  );
  url.searchParams.set("maxResults", "100");
  const listed = await gmailJson<{
    messages?: Array<{ id?: string }>;
    historyId?: string;
  }>(request, url, input.accessToken);
  const candidates = await hydrateCandidates(
    (listed.messages ?? []).flatMap(({ id }) => (id ? [id] : [])),
    input.accessToken,
    request
  );
  return {
    candidates: candidates.filter(
      ({ receivedAt }) => new Date(receivedAt) >= cutoff
    ),
    historyId:
      listed.historyId ??
      (await currentHistoryId(input.accessToken, request))
  };
}

export async function fetchIncrementalInboxCandidates(input: {
  accessToken: string;
  startHistoryId: string;
  request?: Requester;
}): Promise<{ candidates: GmailCandidate[]; historyId: string }> {
  const request = input.request ?? fetch;
  const url = new URL(
    "https://gmail.googleapis.com/gmail/v1/users/me/history"
  );
  url.searchParams.set("startHistoryId", input.startHistoryId);
  url.searchParams.set("historyTypes", "messageAdded");
  url.searchParams.set("labelId", "INBOX");
  url.searchParams.set("maxResults", "100");
  const ids: string[] = [];
  let historyId: string | undefined;
  let pageToken: string | undefined;
  do {
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const history = await gmailJson<{
      history?: Array<{
        messagesAdded?: Array<{
          message?: { id?: string; labelIds?: string[] };
        }>;
      }>;
      historyId?: string;
      nextPageToken?: string;
    }>(request, url, input.accessToken);
    ids.push(
      ...(history.history ?? []).flatMap(({ messagesAdded }) =>
        (messagesAdded ?? []).flatMap(({ message }) =>
          message?.id && message.labelIds?.includes("INBOX") ? [message.id] : []
        )
      )
    );
    historyId = history.historyId ?? historyId;
    pageToken = history.nextPageToken;
  } while (pageToken);
  return {
    candidates: await hydrateCandidates(ids, input.accessToken, request),
    historyId:
      historyId ??
      (await currentHistoryId(input.accessToken, request))
  };
}

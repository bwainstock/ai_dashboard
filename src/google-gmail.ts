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
    const code: Extract<
      OperationalCode,
      "GMAIL_OAUTH_REVOKED" | "GMAIL_API_FAILED"
    > =
      response.status === 401 ? "GMAIL_OAUTH_REVOKED" : "GMAIL_API_FAILED";
    throw Object.assign(new Error("Gmail API request failed"), {
      code
    });
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

async function hydrateCandidates(
  ids: string[],
  accessToken: string,
  request: Requester
): Promise<GmailCandidate[]> {
  const unique = [...new Set(ids)];
  const messages = await Promise.all(
    unique.map((id) => {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`
      );
      url.searchParams.set("format", "full");
      return gmailJson<GmailMessage>(request, url, accessToken);
    })
  );
  return messages.flatMap((message) => {
    if (!message.id || !message.threadId) return [];
    return [
      {
        messageId: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds ?? [],
        from: header(message, "From") ?? "",
        subject: header(message, "Subject") ?? "",
        body: textBody(message.payload),
        receivedAt: new Date(Number(message.internalDate ?? 0)).toISOString(),
        ...(header(message, "List-Unsubscribe")
          ? { listUnsubscribe: header(message, "List-Unsubscribe") }
          : {}),
        ...(header(message, "Precedence")
          ? { precedence: header(message, "Precedence") }
          : {})
      }
    ];
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

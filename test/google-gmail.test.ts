import { describe, expect, test, vi } from "vitest";
import {
  fetchInitialInboxCandidates,
  fetchIncrementalInboxCandidates
} from "../src/google-gmail";

describe("Gmail scan windows", () => {
  test("initial scan is Inbox-only and never exceeds the previous seven days", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: "too-old" }],
            historyId: "101"
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "too-old",
            threadId: "thread",
            labelIds: ["INBOX"],
            internalDate: String(
              new Date("2026-09-30T17:59:59.000Z").getTime()
            ),
            payload: { headers: [], body: {} }
          })
        )
      );

    const result = await fetchInitialInboxCandidates({
      accessToken: "token",
      now: new Date("2026-10-07T18:00:00.000Z"),
      request
    });

    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(url.searchParams.get("labelIds")).toBe("INBOX");
    expect(url.searchParams.get("q")).toBe("after:2026/09/30");
    expect(result.candidates).toEqual([]);
    expect(result.historyId).toBe("101");
  });

  test("later scans use only incremental Inbox message-added history", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ history: [], historyId: "202" }))
    );

    const result = await fetchIncrementalInboxCandidates({
      accessToken: "token",
      startHistoryId: "101",
      request
    });

    const url = new URL(String(request.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/gmail/v1/users/me/history");
    expect(url.searchParams.get("startHistoryId")).toBe("101");
    expect(url.searchParams.get("historyTypes")).toBe("messageAdded");
    expect(url.searchParams.get("labelId")).toBe("INBOX");
    expect(result.historyId).toBe("202");
  });
});

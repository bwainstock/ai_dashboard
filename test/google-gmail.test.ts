import { describe, expect, test, vi } from "vitest";
import {
  fetchInitialInboxCandidates,
  fetchIncrementalInboxCandidates
} from "../src/google-gmail";

function multipartResponse(
  parts: Array<{
    contentId: string;
    status?: number;
    body?: unknown;
    bodyText?: string;
  }>,
  preamble = ""
): Response {
  const boundary = "gmail-test-response";
  const body = preamble + [
    ...parts.flatMap(({ contentId, status = 200, body, bodyText }) => [
      `--${boundary}`,
      "Content-Type: application/http",
      `Content-ID: <response-${contentId}>`,
      "",
      `HTTP/1.1 ${status} ${status === 200 ? "OK" : "Error"}`,
      "Content-Type: application/json; charset=UTF-8",
      "Vary: Origin",
      "Vary: X-Origin",
      "",
      bodyText ?? JSON.stringify(body),
    ]),
    `--${boundary}--`,
    ""
  ].join("\r\n");
  return new Response(body, {
    headers: { "content-type": `multipart/mixed; boundary=${boundary}` }
  });
}

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
        multipartResponse([
          {
            contentId: "item-0",
            body: {
            id: "too-old",
            threadId: "thread",
            labelIds: ["INBOX"],
            internalDate: String(
              new Date("2026-09-30T17:59:59.000Z").getTime()
            ),
            payload: { headers: [], body: {} }
            }
          }
        ])
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

  test("initial scan hydrates 100 candidates in provider order with at most 40 calls in each of three outer batch requests", async () => {
    const ids = Array.from({ length: 100 }, (_, index) => `message-${index}`);
    const batchSizes: number[] = [];
    const request = vi.fn(async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const url = new URL(String(input));
      if (url.pathname === "/gmail/v1/users/me/messages") {
        return new Response(
          JSON.stringify({
            messages: ids.map((id) => ({ id })),
            historyId: "303"
          })
        );
      }

      expect(url.href).toBe("https://gmail.googleapis.com/batch/gmail/v1");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer token"
      );
      const body = String(init?.body);
      expect(body).not.toMatch(/\r\nauthorization:/i);
      const calls = [...body.matchAll(
        /Content-ID: <(item-\d+)>\r\n\r\nGET \/gmail\/v1\/users\/me\/messages\/([^?\r\n]+)\?format=full HTTP\/1\.1/g
      )];
      batchSizes.push(calls.length);
      return multipartResponse(
        calls
          .map(([, contentId, encodedId]) => {
            const id = decodeURIComponent(encodedId ?? "");
            return {
              contentId: contentId ?? "",
              body: {
                id,
                threadId: `thread-${id}`,
                labelIds: ["INBOX"],
                internalDate: String(
                  new Date("2026-10-07T12:00:00.000Z").getTime()
                ),
                payload: { headers: [], body: {} }
              }
            };
          })
          .reverse()
      );
    });

    const result = await fetchInitialInboxCandidates({
      accessToken: "token",
      now: new Date("2026-10-09T12:00:00.000Z"),
      request
    });

    expect(result.candidates.map(({ messageId }) => messageId)).toEqual(ids);
    expect(batchSizes).toEqual([40, 40, 20]);
  });

  test("initial scan retries an affected batch after an inner 503 and preserves provider order", async () => {
    vi.useFakeTimers();
    try {
      const ids = Array.from({ length: 41 }, (_, index) => `message-${index}`);
      const batchSizes: number[] = [];
      let secondBatchAttempt = 0;
      const request = vi.fn(async (
        input: string | URL | Request,
        init?: RequestInit
      ) => {
        const url = new URL(String(input));
        if (url.pathname === "/gmail/v1/users/me/messages") {
          return new Response(
            JSON.stringify({
              messages: ids.map((id) => ({ id })),
              historyId: "304"
            })
          );
        }

        const calls = [...String(init?.body).matchAll(
          /Content-ID: <(item-\d+)>\r\n\r\nGET \/gmail\/v1\/users\/me\/messages\/([^?\r\n]+)\?format=full HTTP\/1\.1/g
        )];
        batchSizes.push(calls.length);
        if (calls[0]?.[1] === "item-40" && secondBatchAttempt++ === 0) {
          return multipartResponse([
            {
              contentId: "item-40",
              status: 503,
              body: { error: { message: "try again" } }
            }
          ]);
        }
        return multipartResponse(
          calls.map(([, contentId, encodedId]) => {
            const id = decodeURIComponent(encodedId ?? "");
            return {
              contentId: contentId ?? "",
              body: {
                id,
                threadId: `thread-${id}`,
                labelIds: ["INBOX"],
                internalDate: String(
                  new Date("2026-10-09T12:00:00.000Z").getTime()
                ),
                payload: { headers: [], body: {} }
              }
            };
          })
        );
      });

      const scan = fetchInitialInboxCandidates({
        accessToken: "token",
        now: new Date("2026-10-09T13:00:00.000Z"),
        request
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(request).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);

      await expect(scan).resolves.toMatchObject({
        candidates: ids.map((messageId) => ({ messageId })),
        historyId: "304"
      });
      expect(batchSizes).toEqual([40, 1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([429, 500, 502, 503, 504])(
    "initial scan retries an outer %i batch response",
    async (status) => {
      vi.useFakeTimers();
      try {
        const request = vi
          .fn()
          .mockResolvedValueOnce(
            new Response(
              JSON.stringify({
                messages: [{ id: "first" }],
                historyId: "305"
              })
            )
          )
          .mockResolvedValueOnce(new Response(null, { status }))
          .mockResolvedValueOnce(
            multipartResponse([
              {
                contentId: "item-0",
                body: {
                  id: "first",
                  threadId: "thread-first",
                  labelIds: ["INBOX"],
                  internalDate: String(
                    new Date("2026-10-09T12:00:00.000Z").getTime()
                  ),
                  payload: { headers: [], body: {} }
                }
              }
            ])
          );

        const scan = fetchInitialInboxCandidates({
          accessToken: "token",
          now: new Date("2026-10-09T13:00:00.000Z"),
          request
        });
        const result = expect(scan).resolves.toMatchObject({
          candidates: [{ messageId: "first" }],
          historyId: "305"
        });
        await vi.advanceTimersByTimeAsync(499);
        expect(request).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);

        await result;
        expect(request).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    }
  );

  test("initial scan accepts a whitespace MIME preamble and preserves provider order", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: "first" }, { id: "second" }],
            historyId: "404"
          })
        )
      )
      .mockResolvedValueOnce(
        multipartResponse(
          [
            {
              contentId: "item-1",
              body: {
                id: "second",
                threadId: "thread-second",
                labelIds: ["INBOX"],
                internalDate: String(
                  new Date("2026-10-09T11:00:00.000Z").getTime()
                ),
                payload: { headers: [], body: {} }
              }
            },
            {
              contentId: "item-0",
              body: {
                id: "first",
                threadId: "thread-first",
                labelIds: ["INBOX"],
                internalDate: String(
                  new Date("2026-10-09T11:00:00.000Z").getTime()
                ),
                payload: { headers: [], body: {} }
              }
            }
          ],
          "\r\n"
        )
      );

    const result = await fetchInitialInboxCandidates({
      accessToken: "token",
      now: new Date("2026-10-09T12:00:00.000Z"),
      request
    });

    expect(result.candidates.map(({ messageId }) => messageId)).toEqual([
      "first",
      "second"
    ]);
  });

  test("initial scan fails atomically after three attempts of an affected batch", async () => {
    vi.useFakeTimers();
    try {
      const ids = Array.from({ length: 41 }, (_, index) => `message-${index}`);
      const batchSizes: number[] = [];
      const request = vi.fn(async (
        input: string | URL | Request,
        init?: RequestInit
      ) => {
        const url = new URL(String(input));
        if (url.pathname === "/gmail/v1/users/me/messages") {
          return new Response(
            JSON.stringify({
              messages: ids.map((id) => ({ id })),
              historyId: "505"
            })
          );
        }
        const calls = [...String(init?.body).matchAll(
          /Content-ID: <(item-\d+)>\r\n\r\nGET \/gmail\/v1\/users\/me\/messages\/([^?\r\n]+)\?format=full HTTP\/1\.1/g
        )];
        batchSizes.push(calls.length);
        if (calls[0]?.[1] === "item-40") {
          return multipartResponse([
            {
              contentId: "item-40",
              status: 503,
              body: { error: { message: "failure" } }
            }
          ]);
        }
        return multipartResponse(
          calls.map(([, contentId, encodedId]) => {
            const id = decodeURIComponent(encodedId ?? "");
            return {
              contentId: contentId ?? "",
              body: {
                id,
                threadId: `thread-${id}`,
                internalDate: String(
                  new Date("2026-10-09T11:00:00.000Z").getTime()
                ),
                payload: { headers: [], body: {} }
              }
            };
          })
        );
      });

      const scan = fetchInitialInboxCandidates({
        accessToken: "token",
        now: new Date("2026-10-09T12:00:00.000Z"),
        request
      });
      const failure = expect(scan).rejects.toMatchObject({
        code: "GMAIL_API_FAILED"
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(request).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      expect(request).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1499);
      expect(request).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(1);

      await failure;
      expect(request).toHaveBeenCalledTimes(5);
      expect(batchSizes).toEqual([40, 1, 1, 1]);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each([
    {
      name: "missing result",
      response: multipartResponse([
        { contentId: "item-0", body: { id: "first" } }
      ])
    },
    {
      name: "duplicate result",
      response: multipartResponse([
        { contentId: "item-0", body: { id: "first" } },
        { contentId: "item-0", body: { id: "first-again" } }
      ])
    },
    {
      name: "invalid JSON",
      response: multipartResponse([
        { contentId: "item-0", bodyText: "{" },
        { contentId: "item-1", body: { id: "second" } }
      ])
    },
    {
      name: "malformed multipart",
      response: new Response("not multipart", {
        headers: {
          "content-type": "multipart/mixed; boundary=missing-boundary"
        }
      })
    },
    {
      name: "non-whitespace MIME preamble",
      response: multipartResponse(
        [
          { contentId: "item-0", body: { id: "first" } },
          { contentId: "item-1", body: { id: "second" } }
        ],
        "unexpected preamble"
      )
    }
  ])("initial scan rejects a $name batch response", async ({ response }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: "first" }, { id: "second" }],
            historyId: "606"
          })
        )
      )
      .mockResolvedValueOnce(response);

    await expect(
      fetchInitialInboxCandidates({
        accessToken: "token",
        now: new Date("2026-10-09T12:00:00.000Z"),
        request
      })
    ).rejects.toMatchObject({ code: "GMAIL_API_FAILED" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test.each(
    [400, 403, 404].flatMap((status) => [
      {
        name: `outer ${status}`,
        response: new Response(null, { status })
      },
      {
        name: `inner ${status}`,
        response: multipartResponse([
          {
            contentId: "item-0",
            status,
            body: { error: { message: "failure" } }
          }
        ])
      }
    ])
  )("initial scan does not retry an $name batch failure", async ({ response }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: "first" }],
            historyId: "607"
          })
        )
      )
      .mockResolvedValueOnce(response);

    await expect(
      fetchInitialInboxCandidates({
        accessToken: "token",
        now: new Date("2026-10-09T12:00:00.000Z"),
        request
      })
    ).rejects.toMatchObject({ code: "GMAIL_API_FAILED" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test.each([
    {
      name: "outer",
      response: new Response(null, { status: 401 })
    },
    {
      name: "inner",
      response: multipartResponse([
        {
          contentId: "item-0",
          status: 401,
          body: { error: { message: "revoked" } }
        }
      ])
    }
  ])("initial scan maps an $name 401 to OAuth revoked", async ({ response }) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            messages: [{ id: "first" }],
            historyId: "707"
          })
        )
      )
      .mockResolvedValueOnce(response);

    await expect(
      fetchInitialInboxCandidates({
        accessToken: "token",
        now: new Date("2026-10-09T12:00:00.000Z"),
        request
      })
    ).rejects.toMatchObject({ code: "GMAIL_OAUTH_REVOKED" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  test("later scans use only incremental Inbox message-added history", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            history: [
              {
                messagesAdded: [
                  { message: { id: "second", labelIds: ["INBOX"] } },
                  { message: { id: "first", labelIds: ["INBOX"] } },
                  { message: { id: "second", labelIds: ["INBOX"] } }
                ]
              }
            ],
            historyId: "202"
          })
        )
      )
      .mockResolvedValueOnce(
        multipartResponse([
          {
            contentId: "item-1",
            body: {
              id: "first",
              threadId: "thread-first",
              internalDate: "1",
              payload: { headers: [], body: {} }
            }
          },
          {
            contentId: "item-0",
            body: {
              id: "second",
              threadId: "thread-second",
              internalDate: "1",
              payload: { headers: [], body: {} }
            }
          }
        ])
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
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.candidates.map(({ messageId }) => messageId)).toEqual([
      "second",
      "first"
    ]);
    expect(result.historyId).toBe("202");
  });
});

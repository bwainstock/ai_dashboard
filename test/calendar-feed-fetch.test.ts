import { describe, expect, test, vi } from "vitest";
import { gzipSync } from "node:zlib";
import {
  fetchCalendarFeed,
  fetchCalendarFeedsBounded
} from "../src/calendar-feed-fetch";

describe("safe Calendar Feed fetching", () => {
  test("fetches and parses a public HTTPS iCalendar feed", async () => {
    const fetcher = vi.fn(async () =>
      new Response("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n", {
        headers: {
          "content-type": "text/calendar",
          etag: '"feed-v1"',
          "last-modified": "Sun, 18 Oct 2026 19:00:00 GMT"
        }
      })
    );

    await expect(
      fetchCalendarFeed("https://calendar.example.com/private.ics?token=secret", {
        fetcher,
        resolveHostname: async () => ["93.184.216.34"],
        parse: async (input) => {
          expect(input).toContain("BEGIN:VCALENDAR");
          return [{ uid: "event-1" }];
        }
      })
    ).resolves.toEqual({
      kind: "updated",
      snapshot: [{ uid: "event-1" }],
      etag: '"feed-v1"',
      lastModified: "Sun, 18 Oct 2026 19:00:00 GMT"
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://calendar.example.com/private.ics?token=secret",
      expect.objectContaining({
        method: "GET",
        redirect: "manual"
      })
    );
  });

  test.each([
    ["http://calendar.example.com/feed.ics", "unsafe_url"],
    ["https://user:secret@calendar.example.com/feed.ics", "unsafe_url"],
    ["https://calendar.example.com:8443/feed.ics", "unsafe_url"],
    ["https://calendar.example.com/feed.ics#private", "unsafe_url"]
  ])("rejects unsafe destination %s", async (url, code) => {
    await expect(
      fetchCalendarFeed(url, {
        fetcher: vi.fn(),
        resolveHostname: vi.fn(),
        parse: vi.fn()
      })
    ).rejects.toMatchObject({ code });
  });

  test.each([
    " https://calendar.example.com/feed.ics",
    "https://calendar.example.com/feed calendar.ics"
  ])("uses the persisted URL shape rules at fetch time for %s", async (url) => {
    await expect(
      fetchCalendarFeed(url, {
        fetcher: vi.fn(),
        resolveHostname: vi.fn(),
        parse: vi.fn()
      })
    ).rejects.toMatchObject({ code: "unsafe_url" });
  });

  test.each([
    "127.0.0.1",
    "10.10.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.20.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1"
  ])("rejects non-public resolved address %s", async (address) => {
    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher: vi.fn(),
        resolveHostname: async () => [address],
        parse: vi.fn()
      })
    ).rejects.toMatchObject({ code: "unsafe_address" });
  });

  test("validates every redirect destination and follows no more than three", async () => {
    const fetched: string[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      fetched.push(value);
      const index = fetched.length;
      return index < 4
        ? new Response(null, {
            status: 302,
            headers: { location: `https://redirect-${index}.example.com/feed.ics` }
          })
        : new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
    });
    const resolved: string[] = [];

    await fetchCalendarFeed("https://calendar.example.com/feed.ics", {
      fetcher,
      resolveHostname: async (hostname) => {
        resolved.push(hostname);
        return ["93.184.216.34"];
      },
      parse: async () => []
    });
    expect(resolved).toEqual([
      "calendar.example.com",
      "redirect-1.example.com",
      "redirect-2.example.com",
      "redirect-3.example.com"
    ]);

    fetcher.mockImplementation(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://another.example.com/feed.ics" }
      })
    );
    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher,
        resolveHostname: async () => ["93.184.216.34"],
        parse: async () => []
      })
    ).rejects.toMatchObject({ code: "too_many_redirects" });
  });

  test("rejects a redirect that resolves to a private address", async () => {
    const fetcher = vi.fn(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://internal.example.com/feed.ics" }
      })
    );

    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher,
        resolveHostname: async (hostname) =>
          hostname === "internal.example.com"
            ? ["10.0.0.5"]
            : ["93.184.216.34"],
        parse: async () => []
      })
    ).rejects.toMatchObject({ code: "unsafe_address" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("sends validators and treats 304 as unchanged", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 304 })
    );

    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher,
        resolveHostname: async () => ["93.184.216.34"],
        parse: vi.fn(),
        etag: '"feed-v1"',
        lastModified: "Sun, 18 Oct 2026 19:00:00 GMT"
      })
    ).resolves.toEqual({ kind: "unchanged" });
    const init = fetcher.mock.calls[0][1];
    expect(new Headers(init?.headers)).toMatchObject(
      expect.objectContaining({})
    );
    expect(new Headers(init?.headers).get("if-none-match")).toBe('"feed-v1"');
    expect(new Headers(init?.headers).get("if-modified-since")).toBe(
      "Sun, 18 Oct 2026 19:00:00 GMT"
    );
  });

  test("limits compressed and decompressed response sizes", async () => {
    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher: async () =>
          new Response("small", {
            headers: { "content-length": String(2 * 1024 * 1024 + 1) }
          }),
        resolveHostname: async () => ["93.184.216.34"],
        parse: async () => []
      })
    ).rejects.toMatchObject({ code: "compressed_too_large" });

    const compressed = gzipSync("x".repeat(10 * 1024 * 1024 + 1));
    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher: async () =>
          new Response(compressed, {
            headers: { "content-encoding": "gzip" }
          }),
        resolveHostname: async () => ["93.184.216.34"],
        parse: async () => []
      })
    ).rejects.toMatchObject({ code: "decompressed_too_large" });
  });

  test("accepts a response transparently decompressed by the fetch runtime", async () => {
    const calendar =
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//EN\r\nEND:VCALENDAR\r\n";

    await expect(
      fetchCalendarFeed("https://calendar.example.com/feed.ics", {
        fetcher: async () =>
          new Response(calendar, {
            headers: { "content-encoding": "gzip" }
          }),
        resolveHostname: async () => ["93.184.216.34"],
        parse: async (input) => {
          expect(input).toBe(calendar);
          return [];
        }
      })
    ).resolves.toMatchObject({ kind: "updated", snapshot: [] });
  });

  test("aborts the complete redirect chain after ten seconds", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );
    const result = fetchCalendarFeed("https://calendar.example.com/feed.ics", {
      fetcher,
      resolveHostname: async () => ["93.184.216.34"],
      parse: async () => []
    });
    const expectation = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
    vi.useRealTimers();
  });

  test("applies the deadline while DNS resolution is pending", async () => {
    vi.useFakeTimers();
    const result = fetchCalendarFeed("https://calendar.example.com/feed.ics", {
      fetcher: vi.fn(),
      resolveHostname: async () => new Promise<string[]>(() => {}),
      parse: async () => []
    });
    const expectation = expect(result).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await expectation;
    vi.useRealTimers();
  });

  test("bounds concurrent feed requests", async () => {
    let active = 0;
    let maximum = 0;
    const results = await fetchCalendarFeedsBounded(
      Array.from({ length: 10 }, (_, index) => index),
      async (index) => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active -= 1;
        return index * 2;
      },
      3
    );

    expect(results).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
    expect(maximum).toBe(3);
  });

  test("never adds authentication headers or cookies", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n")
    );
    await fetchCalendarFeed(
      "https://calendar.example.com/private.ics?token=bearer-secret",
      {
        fetcher,
        resolveHostname: async () => ["93.184.216.34"],
        parse: async () => []
      }
    );

    const headers = new Headers(fetcher.mock.calls[0][1]?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
  });
});

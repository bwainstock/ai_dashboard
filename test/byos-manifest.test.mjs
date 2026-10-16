import { describe, expect, test, vi } from "vitest";
import {
  downloadByosDisplay,
  MAX_REFRESH_RATE_SECONDS,
  parseByosManifest
} from "../scripts/byos-manifest-lib.mjs";

describe("ESPHome BYOS manifest contract", () => {
  test("accepts a successful same-origin manifest and preserves its cache identity", () => {
    expect(
      parseByosManifest(
        {
          status: 0,
          image_url:
            "https://dashboard-device.example.com/images/daily-brief-generation.png",
          filename: "daily-brief-generation.png",
          refresh_rate: 14_400
        },
        "https://dashboard-device.example.com"
      )
    ).toEqual({
      imageUrl:
        "https://dashboard-device.example.com/images/daily-brief-generation.png",
      filename: "daily-brief-generation.png",
      refreshRateSeconds: 14_400
    });
  });

  test("accepts the exact private image route with an encoded filename", () => {
    expect(
      parseByosManifest(
        {
          status: 0,
          image_url:
            "https://dashboard-device.example.com/images/daily%20brief.png",
          filename: "daily brief.png",
          refresh_rate: 60
        },
        "https://dashboard-device.example.com"
      )
    ).toMatchObject({
      imageUrl:
        "https://dashboard-device.example.com/images/daily%20brief.png",
      filename: "daily brief.png"
    });
  });

  test.each([
    ["non-object JSON", null],
    ["non-success status", { status: 401 }],
    [
      "missing image URL",
      { status: 0, filename: "daily.png", refresh_rate: 60 }
    ],
    [
      "missing filename",
      {
        status: 0,
        image_url: "https://dashboard-device.example.com/images/daily.png",
        refresh_rate: 60
      }
    ],
    [
      "nonpositive refresh interval",
      {
        status: 0,
        image_url: "https://dashboard-device.example.com/images/daily.png",
        filename: "daily.png",
        refresh_rate: 0
      }
    ],
    [
      "unbounded refresh interval",
      {
        status: 0,
        image_url: "https://dashboard-device.example.com/images/daily.png",
        filename: "daily.png",
        refresh_rate: MAX_REFRESH_RATE_SECONDS + 1
      }
    ],
    [
      "cross-origin image URL",
      {
        status: 0,
        image_url: "https://attacker.example/images/daily.png",
        filename: "daily.png",
        refresh_rate: 60
      }
    ],
    [
      "filename that differs from the image URL",
      {
        status: 0,
        image_url: "https://dashboard-device.example.com/images/other.png",
        filename: "daily.png",
        refresh_rate: 60
      }
    ],
    [
      "image URL query string",
      {
        status: 0,
        image_url:
          "https://dashboard-device.example.com/images/daily.png?token=leaked",
        filename: "daily.png",
        refresh_rate: 60
      }
    ],
    [
      "image URL fragment",
      {
        status: 0,
        image_url:
          "https://dashboard-device.example.com/images/daily.png#unexpected",
        filename: "daily.png",
        refresh_rate: 60
      }
    ],
    [
      "image URL outside the exact images path",
      {
        status: 0,
        image_url:
          "https://dashboard-device.example.com/archive/images/daily.png",
        filename: "daily.png",
        refresh_rate: 60
      }
    ]
  ])("rejects %s", (_label, manifest) => {
    expect(() =>
      parseByosManifest(manifest, "https://dashboard-device.example.com")
    ).toThrow();
  });

  test("downloads the selected private image with credentials in headers only", async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url: String(url), options });
      if (requests.length === 1) {
        return Response.json({
          status: 0,
          image_url:
            "https://dashboard-device.example.com/images/daily-brief-generation.png",
          filename: "daily-brief-generation.png",
          refresh_rate: 14_400
        });
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        headers: { "content-type": "image/png" }
      });
    };

    const result = await downloadByosDisplay({
      deviceOrigin: "https://dashboard-device.example.com",
      deviceId: "AA:BB:CC:DD:EE:FF",
      accessToken: "private-token",
      wakeSource: "timer",
      fetchImpl
    });

    expect(result).toMatchObject({
      filename: "daily-brief-generation.png",
      refreshRateSeconds: 14_400,
      contentType: "image/png"
    });
    expect(result.imageBytes).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(requests.map(({ url }) => url)).toEqual([
      "https://dashboard-device.example.com/api/display",
      "https://dashboard-device.example.com/images/daily-brief-generation.png"
    ]);
    for (const { url, options } of requests) {
      expect(url).not.toContain("private-token");
      expect(options).toMatchObject({
        redirect: "manual",
        headers: {
          ID: "AA:BB:CC:DD:EE:FF",
          "Access-Token": "private-token"
        }
      });
    }
    expect(requests[0].options.headers["Update-Source"]).toBe("timer");
    expect(requests[1].options.headers["Update-Source"]).toBeUndefined();
  });

  test.each([
    ["non-success response", new Response("unauthorized", { status: 401 })],
    [
      "redirect response",
      new Response(null, {
        status: 302,
        headers: { location: "https://attacker.example/display" }
      })
    ],
    [
      "malformed JSON",
      new Response("{", { headers: { "content-type": "application/json" } })
    ]
  ])("rejects a %s without making an image request", async (_label, response) => {
    const fetchImpl = vi.fn().mockResolvedValue(response);

    await expect(
      downloadByosDisplay({
        deviceOrigin: "https://dashboard-device.example.com",
        deviceId: "AA:BB:CC:DD:EE:FF",
        accessToken: "private-token",
        wakeSource: "timer",
        fetchImpl
      })
    ).rejects.toThrow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

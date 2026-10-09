import { describe, expect, test } from "vitest";
import {
  buildCalendarAuthorizationUrl,
  decryptRefreshToken,
  encryptRefreshToken
} from "../src/calendar-oauth";

describe("Google Calendar OAuth", () => {
  test("requests offline read-only access for either household account", () => {
    const url = new URL(
      buildCalendarAuthorizationUrl({
        clientId: "client-id",
        redirectUri: "https://admin.example.com/admin/calendar/oauth/callback",
        state: "signed-state"
      })
    );

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth"
    );
    expect(url.searchParams.get("scope")).toBe(
      [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/gmail.readonly"
      ].join(" ")
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("signed-state");
  });

  test("refresh tokens are authenticated-encrypted before persistence", async () => {
    const stored = await encryptRefreshToken(
      "refresh-token-value",
      "test application encryption key"
    );

    expect(stored).not.toContain("refresh-token-value");
    expect(JSON.parse(stored)).toMatchObject({ version: 1 });
    expect(
      await decryptRefreshToken(stored, "test application encryption key")
    ).toBe("refresh-token-value");
    await expect(
      decryptRefreshToken(stored, "wrong encryption key")
    ).rejects.toThrow();
  });
});

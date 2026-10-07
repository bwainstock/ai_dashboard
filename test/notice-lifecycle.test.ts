import { describe, expect, test } from "vitest";
import {
  noticeLifecycle,
  noticeGraceDays
} from "../src/notice-lifecycle";

describe("Household Notice lifecycle", () => {
  test("expires dated notices after the date plus the configured grace period", () => {
    expect(
      noticeLifecycle(
        "2026-10-10",
        new Date("2026-10-07T18:00:00.000Z"),
        "5"
      )
    ).toEqual({
      expiresAt: "2026-10-15T12:00:00.000Z",
      retainedUntil: "2026-11-14T12:00:00.000Z"
    });
  });

  test("uses a bounded default when grace configuration is missing or invalid", () => {
    expect(noticeGraceDays(undefined)).toBe(3);
    expect(noticeGraceDays("0")).toBe(3);
    expect(noticeGraceDays("31")).toBe(3);
    expect(noticeGraceDays("4")).toBe(4);
  });

  test("undated notices remain active for fourteen days plus grace", () => {
    expect(
      noticeLifecycle(
        null,
        new Date("2026-10-07T18:00:00.000Z"),
        "3"
      ).expiresAt
    ).toBe("2026-10-24T18:00:00.000Z");
  });
});

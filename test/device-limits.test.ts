import { describe, expect, test } from "vitest";
import {
  DEVICE_LIMITS,
  effectiveMaximumImageBytes
} from "../src/device-limits";

describe("tested device limits", () => {
  test("uses the evidence-backed image limit when deployment configuration is absent", () => {
    expect(effectiveMaximumImageBytes()).toBe(DEVICE_LIMITS.maximumImageBytes);
  });

  test("deployment configuration may tighten but cannot exceed the tested limit", () => {
    expect(effectiveMaximumImageBytes("500000")).toBe(500_000);
    expect(effectiveMaximumImageBytes("2000000")).toBe(
      DEVICE_LIMITS.maximumImageBytes
    );
  });
});

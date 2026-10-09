import { describe, expect, test } from "vitest";
import {
  OPERATIONAL_CODES,
  isPublicationBlockingOperationalCode,
  statusSafeOperationalCode
} from "../src/operational-codes";

const PRODUCED_CODES = [
  "WEATHER_FETCH_FAILED",
  "WEATHER_UPSTREAM_HTTP",
  "WEATHER_UPSTREAM_NETWORK",
  "WEATHER_INVALID_RESPONSE",
  "LUNCH_UPSTREAM_HTTP",
  "LUNCH_UPSTREAM_NETWORK",
  "LUNCH_INVALID_RESPONSE",
  "CALENDAR_FETCH_FAILED",
  "CALENDAR_OAUTH_REVOKED",
  "CALENDAR_UPSTREAM_HTTP",
  "GMAIL_PROCESSING_FAILED",
  "GMAIL_OAUTH_REVOKED",
  "GMAIL_API_FAILED",
  "GMAIL_PROCESSOR_UNREACHABLE",
  "GOOGLE_ACCOUNT_CLEANUP_PENDING",
  "GOOGLE_REVOCATION_FAILED",
  "DAILY_BRIEF_RENDER_FAILED",
  "CALENDAR_VIEW_RENDER_FAILED",
  "LUNCH_VIEW_RENDER_FAILED",
  "NOTICES_VIEW_RENDER_FAILED",
  "RENDERED_IMAGE_INVALID",
  "GENERATION_PUBLICATION_FAILED",
  "AI_QUOTA_EXHAUSTED",
  "OAUTH_REVOKED_OR_EXPIRED",
  "SOURCE_SCHEDULED_FAILURE",
  "GMAIL_PROCESSING_REPEATED_FAILURE",
  "GENERATION_PUBLICATION_BLOCKED",
  "DEVICE_AUTH_SUSPICIOUS",
  "DEVICE_CHECK_IN_MISSING"
] as const;

describe("canonical operational-code taxonomy", () => {
  test("keeps every produced or persisted fixed code status-visible", () => {
    expect(Object.keys(OPERATIONAL_CODES).sort()).toEqual(
      [...PRODUCED_CODES].sort()
    );
    for (const code of PRODUCED_CODES) {
      expect(statusSafeOperationalCode(code)).toBe(code);
    }
  });

  test("does not expose arbitrary error content as an operational code", () => {
    expect(statusSafeOperationalCode("mail from child@example.com failed")).toBe(
      null
    );
  });

  test("classifies every atomic-publication failure as publication-blocking", () => {
    for (const code of [
      "DAILY_BRIEF_RENDER_FAILED",
      "CALENDAR_VIEW_RENDER_FAILED",
      "LUNCH_VIEW_RENDER_FAILED",
      "NOTICES_VIEW_RENDER_FAILED",
      "RENDERED_IMAGE_INVALID",
      "GENERATION_PUBLICATION_FAILED"
    ]) {
      expect(isPublicationBlockingOperationalCode(code)).toBe(true);
    }
  });
});

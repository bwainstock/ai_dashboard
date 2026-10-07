import { describe, expect, test } from "vitest";
import { noticesViewHtml } from "../src/notices-view";
import type { DailyBriefNotice } from "../src/generation";

const notices: DailyBriefNotice[] = Array.from({ length: 10 }, (_, index) => ({
  category: (["school", "childcare", "activity", "household"] as const)[
    index % 4
  ],
  summary: `Approved notice ${index + 1}`,
  relevantDate: index % 2 === 0 ? "2026-10-10" : null,
  action: index % 2 === 0 ? "Complete the requested action." : null,
  senderOrganization: `Organization ${index + 1}`
}));

describe("Notices View", () => {
  test("shows no more than eight active approved notices with every approved display field", () => {
    const html = noticesViewHtml({
      notices,
      privateNoticeMarkers: [],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain("Notices View");
    expect(html).toContain("Approved notice 1");
    expect(html).toContain("2026-10-10");
    expect(html).toContain("Complete the requested action.");
    expect(html).toContain("Organization 1");
    expect(html).toContain('aria-label="school notice icon"');
    expect(html).toContain('aria-label="childcare notice icon"');
    expect(html).toContain('aria-label="activity notice icon"');
    expect(html).toContain('aria-label="household notice icon"');
    expect(html).toContain("Approved notice 8");
    expect(html).not.toContain("Approved notice 9");
    expect(html).not.toContain("Approved notice 10");
  });

  test("preserves account-only Private Notice Markers without exposing notice details", () => {
    const html = noticesViewHtml({
      notices: [],
      privateNoticeMarkers: [{ accountId: "mom" }, { accountId: "dad" }],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain("Mom Private Notice");
    expect(html).toContain("Dad Private Notice");
    expect(html).not.toContain("Medical appointment is scheduled.");
    expect(html).not.toContain("School Health Office");
    expect(html).not.toContain("2026-10-10");
  });

  test("renders an explicit empty state", () => {
    const html = noticesViewHtml({
      notices: [],
      privateNoticeMarkers: [],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    expect(html).toContain("No active Household Notices");
    expect(html).toContain("data-missing-state");
  });
});

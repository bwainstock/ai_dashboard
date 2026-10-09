import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
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

const chromeExecutable = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser"
].find((candidate): candidate is string =>
  Boolean(candidate && existsSync(candidate))
);

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

  test("Private Notice Markers consume the first slots in the eight-entry limit", () => {
    const html = noticesViewHtml({
      notices,
      privateNoticeMarkers: [{ accountId: "mom" }, { accountId: "dad" }],
      timezone: "America/Los_Angeles",
      updatedAt: "2026-10-07T17:30:00.000Z"
    });

    const entries = [...html.matchAll(/<li(?: class="private")?>/g)];
    expect(entries).toHaveLength(8);
    expect(html.indexOf("Mom Private Notice")).toBeLessThan(
      html.indexOf("Approved notice 1")
    );
    expect(html.indexOf("Dad Private Notice")).toBeLessThan(
      html.indexOf("Approved notice 1")
    );
    expect(html).toContain("Approved notice 6");
    expect(html).not.toContain("Approved notice 7");
  });

  test.skipIf(!chromeExecutable)(
    "keeps long notice summaries and details within the 800x480 render",
    () => {
      const longNotices = notices.map((notice, index) => ({
        ...notice,
        summary: `Approved notice ${index + 1} has a deliberately long summary that must remain represented without expanding its grid row beyond the available height`,
        relevantDate: `Saturday, October ${10 + index}, 2026`,
        action:
          "Complete the requested household action and return every required form before the stated deadline.",
        senderOrganization:
          "Extremely Long Household Organization and Community Services Department"
      }));
      let html = noticesViewHtml({
        notices: longNotices,
        privateNoticeMarkers: [],
        timezone: "America/Los_Angeles",
        updatedAt: "2026-10-07T17:30:00.000Z"
      });
      html = html.replace(
        "</body>",
        `<script>
          const overflowing = Array.from(document.body.querySelectorAll("*"))
            .filter((element) => {
              const bounds = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              const clipsHorizontally = ["hidden", "clip"].includes(style.overflowX);
              const clipsVertically = ["hidden", "clip"].includes(style.overflowY);
              return bounds.left < 0 || bounds.top < 0 ||
                bounds.right > 800 || bounds.bottom > 480 ||
                (!clipsHorizontally && element.scrollWidth > element.clientWidth) ||
                (!clipsVertically &&
                  element.scrollHeight - element.clientHeight > 4);
            });
          document.title = JSON.stringify({
            documentWidth: document.documentElement.scrollWidth,
            documentHeight: document.documentElement.scrollHeight,
            overflowing: overflowing.map((element) => element.tagName)
          });
        </script></body>`
      );

      const rendered = execFileSync(
        chromeExecutable!,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--hide-scrollbars",
          "--window-size=800,567",
          "--dump-dom",
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const result = JSON.parse(
        rendered.match(/<title>(.*?)<\/title>/s)?.[1] ?? "null"
      ) as {
        documentWidth: number;
        documentHeight: number;
        overflowing: string[];
      };

      expect(result).toEqual({
        documentWidth: 800,
        documentHeight: 480,
        overflowing: []
      });
      expect(html).toContain(longNotices[7].summary);
      expect(html).toContain(longNotices[7].action!);
      expect(html).toContain(longNotices[7].senderOrganization);
    },
    15_000
  );

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

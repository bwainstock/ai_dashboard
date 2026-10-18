import { access, readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const root = new URL("../", import.meta.url);

async function exists(path: string): Promise<boolean> {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

describe("Calendar Feed production cutover", () => {
  test("ships no Google OAuth, Gmail, or Notices runtime", async () => {
    const removedPaths = [
      "wrangler.gmail.toml",
      "scripts/promote-gmail-model.mjs",
      "src/calendar-oauth.ts",
      "src/gmail-controls.ts",
      "src/gmail-model-regression.ts",
      "src/gmail-worker.ts",
      "src/gmail.ts",
      "src/google-calendar.ts",
      "src/google-gmail.ts",
      "src/notice-lifecycle.ts",
      "src/notices-view.ts"
    ];

    await expect(
      Promise.all(removedPaths.map(async (path) => [path, await exists(path)]))
    ).resolves.toEqual(removedPaths.map((path) => [path, false]));

    const packageJson = JSON.parse(
      await readFile(new URL("package.json", root), "utf8")
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts.build).toBe("npm run build:device");
    expect(Object.keys(packageJson.scripts)).not.toEqual(
      expect.arrayContaining([
        "build:gmail",
        "gmail:model:promote",
        "privacy:gmail"
      ])
    );

    const wrangler = await readFile(new URL("wrangler.toml", root), "utf8");
    expect(wrangler).not.toMatch(
      /GOOGLE_CLIENT|CALENDAR_TOKEN_ENCRYPTION_KEY|NOTICE_GRACE_DAYS/
    );
  });

  test("purges retired credentials and data with a forward migration", async () => {
    const migration = await readFile(
      new URL("migrations/0016_retire_google_gmail_notices.sql", root),
      "utf8"
    );

    expect(migration).toMatch(/DROP TABLE calendar_accounts/);
    expect(migration).toMatch(/DROP TABLE selected_calendars/);
    expect(migration).toMatch(/DROP TABLE calendar_snapshots/);
    expect(migration).toMatch(/DROP TABLE gmail_sender_allowlist/);
    expect(migration).toMatch(/DROP TABLE household_notices/);
    expect(migration).toMatch(/DROP TABLE gmail_review_records/);
    expect(migration).toMatch(/DROP TABLE gmail_protected_reviews/);
    expect(migration).toMatch(/DELETE FROM source_status WHERE source = 'gmail'/);
    expect(migration).toMatch(
      /DELETE FROM render_generations WHERE view_type = 'notices'/
    );
  });

  test("documents Calendar Feeds as the only active calendar contract", async () => {
    const currentContracts = [
      "docs/adr/0004-replace-google-oauth-with-calendar-feeds.md",
      "docs/calendar-integration.md",
      "docs/design.md",
      "docs/product-requirements.md",
      "docs/acceptance/ticket-5-calendar-view.md",
      "docs/administration.md",
      "GLOSSARY.md"
    ];
    const contents = await Promise.all(
      currentContracts.map((path) => readFile(new URL(path, root), "utf8"))
    );
    const combined = contents.join("\n");
    const activeProductDocs = contents.slice(1).join("\n");

    expect(combined).toContain("Calendar Feed");
    expect(combined).toContain("Calendar unavailable");
    expect(activeProductDocs).not.toMatch(
      /Google OAuth|Gmail|Notices View|Household Notice|Selected Calendar|Discovered Calendar/
    );
    await expect(exists("docs/gmail-integration.md")).resolves.toBe(false);
    await expect(exists("docs/google-oauth-production-cutover.md")).resolves.toBe(
      false
    );
  });
});

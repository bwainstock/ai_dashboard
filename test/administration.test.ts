import { describe, expect, test } from "vitest";
import { handleAuthorizedAdministration } from "../src/admin";

describe("browser administration", () => {
  test("serves a responsive SPA with live operational updates", async () => {
    const pageResponse = await handleAuthorizedAdministration(
      new Request("https://admin.example.com/admin"),
      { DB: {} as D1Database },
      { role: "administrator" }
    );
    const response = await handleAuthorizedAdministration(
      new Request("https://admin.example.com/admin/app.js"),
      { DB: {} as D1Database },
      { role: "administrator" }
    );
    const styleResponse = await handleAuthorizedAdministration(
      new Request("https://admin.example.com/admin/app.css"),
      { DB: {} as D1Database },
      { role: "administrator" }
    );
    const page = await pageResponse.text();
    const script = await response.text();
    const styles = await styleResponse.text();

    expect(pageResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(styleResponse.status).toBe(200);
    expect(page).toContain('content="width=device-width, initial-scale=1');
    expect(page).toContain('href="/admin/app.css"');
    expect(page).toContain('data-route="overview"');
    expect(page).toContain('data-route="feeds"');
    expect(page).toContain('class="mobile-nav"');
    expect(page).toContain("Generate dashboard");
    expect(styles).toContain("@media (min-width: 920px)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("min-height: 46px");
    expect(script).toContain("const POLL_INTERVAL_MS = 8000");
    expect(script).toContain('document.addEventListener("visibilitychange"');
    expect(script).toContain("This page will update automatically");
    expect(script).toContain(
      '"timeout":"The feed did not respond within 10 seconds."'
    );
    expect(script).toContain(
      '"invalid_response":"The response is not a valid supported iCalendar feed."'
    );
    expect(script).toContain('"Feed test failed — " + detail');
    expect(script).toContain('fetch("/admin/generations", { method: "POST" })');
    expect(script).toContain(
      "device will fetch at the next scheduled refresh"
    );
  });
});

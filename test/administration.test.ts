import { describe, expect, test } from "vitest";
import { handleAuthorizedAdministration } from "../src/admin";

describe("browser administration", () => {
  test("includes actionable Calendar Feed test failure messages", async () => {
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
    const page = await pageResponse.text();
    const script = await response.text();

    expect(pageResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(script).toContain(
      '"timeout":"The feed did not respond within 10 seconds."'
    );
    expect(script).toContain(
      '"invalid_response":"The response is not a valid supported iCalendar feed."'
    );
    expect(script).toContain("Feed test failed — \"+detail");
    expect(script).toContain("data-feed-ingestion");
    expect(script).toContain("ingested events · ");
    expect(page).toContain("Generate dashboard now");
    expect(script).toContain('fetch("/admin/generations",{method:"POST"})');
    expect(script).toContain(
      "device will fetch at the next scheduled refresh"
    );
  });
});

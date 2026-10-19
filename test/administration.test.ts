import { describe, expect, test } from "vitest";
import { handleAuthorizedAdministration } from "../src/admin";

describe("browser administration", () => {
  test("includes actionable Calendar Feed test failure messages", async () => {
    const response = await handleAuthorizedAdministration(
      new Request("https://admin.example.com/admin/app.js"),
      { DB: {} as D1Database },
      { role: "administrator" }
    );
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(script).toContain(
      '"timeout":"The feed did not respond within 10 seconds."'
    );
    expect(script).toContain(
      '"invalid_response":"The response is not a valid supported iCalendar feed."'
    );
    expect(script).toContain("Feed test failed — \"+detail");
  });
});

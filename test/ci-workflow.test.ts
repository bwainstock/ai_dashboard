import { readFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";

const WORKFLOW_PATH = new URL(
  "../.github/workflows/validation.yml",
  import.meta.url
);

describe("pull request validation workflow", () => {
  test("runs the complete deterministic validation suite", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("cache: npm");
    expect(workflow).toContain("cache-dependency-path: package-lock.json");
    expect(workflow).toContain("run: npm ci");
    expect(workflow).toContain("run: npm run check");
  });

  test("compiles production four-gray firmware and monochrome rollback", async () => {
    const workflow = await readFile(WORKFLOW_PATH, "utf8");

    expect(workflow).toContain("name: Compile firmware");
    expect(workflow).toMatch(/uses: astral-sh\/setup-uv@[0-9a-f]{40}/);
    expect(workflow).toContain(
      "cp esphome/secrets.example.yaml esphome/secrets.yaml"
    );
    expect(workflow).toMatch(/\n\s+run: npm run esphome:compile\n/);
    expect(workflow).toContain("run: npm run esphome:compile:rollback");
  });
});

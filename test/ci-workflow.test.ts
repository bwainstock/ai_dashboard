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
    expect(workflow).toContain("run: npm run typecheck");
    expect(workflow).toContain("run: npm run lint");
    expect(workflow).toContain("run: npm test");
    expect(workflow).toContain("run: npm run build:device");
    expect(workflow).toContain("run: npm run build:gmail");
  });
});

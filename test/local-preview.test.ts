import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";
import { PNG } from "pngjs";
import { afterEach, expect, test } from "vitest";

const worktree = process.cwd();
const outputDirectory = join(worktree, ".preview-test-output");

afterEach(() => {
  rmSync(outputDirectory, { recursive: true, force: true });
});

function runDailyHtml(html: string) {
  mkdirSync(outputDirectory, { recursive: true });
  const htmlPath = join(outputDirectory, "daily.html");
  writeFileSync(htmlPath, html);
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/render-local-preview.ts",
      "--output",
      join(outputDirectory, "rendered"),
      "--daily-html",
      htmlPath
    ],
    { cwd: worktree, encoding: "utf8" }
  );
}

test(
  "one local command renders labeled Daily Brief and Calendar View previews",
  () => {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/render-local-preview.ts",
        "--output",
        outputDirectory,
        "--now",
        "2026-10-07T17:30:00.000Z"
      ],
      { cwd: worktree, encoding: "utf8" }
    );

    expect(output).toContain("Daily Brief");
    expect(output).toContain("Calendar View");
    expect(existsSync(join(outputDirectory, "daily-brief.png"))).toBe(true);
    expect(existsSync(join(outputDirectory, "calendar-view.png"))).toBe(true);

    const manifest = JSON.parse(
      readFileSync(join(outputDirectory, "preview-manifest.json"), "utf8")
    ) as {
      artifactKind: string;
      capture: {
        width: number;
        height: number;
        scale: number;
        threshold: number;
        fontStrategy: string;
        minimumTextPixels: number;
      };
      views: Array<{ label: string; filename: string }>;
    };

    expect(manifest).toMatchObject({
      artifactKind: "local-renderer-preview",
      capture: {
        width: 800,
        height: 480,
        scale: 1,
        threshold: 128,
        fontStrategy: "sans-serif",
        minimumTextPixels: 14
      },
      views: [
        { label: "Daily Brief", filename: "daily-brief.png" },
        { label: "Calendar View", filename: "calendar-view.png" }
      ]
    });
  },
  10_000
);

test("preview image validation rejects wrong native dimensions", () => {
  mkdirSync(outputDirectory, { recursive: true });
  const imagePath = join(outputDirectory, "wrong-size.png");
  writeFileSync(imagePath, PNG.sync.write(new PNG({ width: 799, height: 480 })));

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/render-local-preview.ts",
      "--validate-image",
      imagePath,
      "--view",
      "Daily Brief"
    ],
    { cwd: worktree, encoding: "utf8" }
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Daily Brief preview image must be 800x480"
  );
});

test("preview image validation rejects a non-binary palette", () => {
  mkdirSync(outputDirectory, { recursive: true });
  const imagePath = join(outputDirectory, "gray.png");
  const png = new PNG({ width: 800, height: 480 });
  png.data.fill(255);
  png.data[0] = 128;
  png.data[1] = 128;
  png.data[2] = 128;
  writeFileSync(imagePath, PNG.sync.write(png));

  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/render-local-preview.ts",
      "--validate-image",
      imagePath,
      "--view",
      "Calendar View"
    ],
    { cwd: worktree, encoding: "utf8" }
  );

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Calendar View preview image must use only opaque black and white"
  );
});

test("preview rendering rejects content outside the native viewport", () => {
  const result = runDailyHtml(`<!doctype html>
    <style>
      * { box-sizing: border-box }
      html, body { width: 800px; height: 480px; margin: 0; overflow: hidden }
      body { color: #000; background: #fff; font: 700 16px sans-serif }
      div { width: 801px }
    </style>
    <div><span role="img">◆</span> Overflowing preview</div>`);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Daily Brief renderer content overflows 800x480"
  );
});

test("preview rendering rejects an unexpected computed font family", () => {
  const result = runDailyHtml(`<!doctype html>
    <style>
      html, body { width: 800px; height: 480px; margin: 0; overflow: hidden }
      body { color: #000; background: #fff; font: 700 16px serif }
    </style>
    <div><span role="img">◆</span> Wrong font preview</div>`);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Daily Brief renderer must use the available sans-serif font family"
  );
});

test("preview rendering rejects visible text below the configured minimum", () => {
  const result = runDailyHtml(`<!doctype html>
    <style>
      html, body { width: 800px; height: 480px; margin: 0; overflow: hidden }
      body { color: #000; background: #fff; font: 700 13px sans-serif }
    </style>
    <div><span role="img">◆</span> Undersized preview text</div>`);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    "Daily Brief renderer text must be at least 14px"
  );
});

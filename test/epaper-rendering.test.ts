import { describe, expect, test } from "vitest";
import { DISPLAY_BASE_CSS } from "../src/display-style";
import { epaperThresholdAt } from "../src/epaper-rendering";

describe("e-paper text edge conversion", () => {
  test("uses one stable threshold across adjacent antialiased text-edge pixels", () => {
    const thresholds = new Set<number>();

    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        thresholds.add(epaperThresholdAt());
      }
    }

    expect([...thresholds]).toEqual([128]);
  });

  test("uses heavy sans-serif strokes instead of fragile narrow or italic faces", () => {
    expect(DISPLAY_BASE_CSS).not.toMatch(/Arial Narrow|Georgia|italic/);
    expect(DISPLAY_BASE_CSS).toMatch(
      /font-family:\s*Arial,\s*Helvetica,\s*sans-serif/,
    );
    expect(DISPLAY_BASE_CSS).toMatch(/\.serif[\s\S]*font-weight:\s*900/);
  });
});

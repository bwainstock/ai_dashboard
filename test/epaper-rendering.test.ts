import { describe, expect, test } from "vitest";
import { DISPLAY_BASE_CSS } from "../src/display-style";
import {
  EPAPER_LUMINANCE_LEVELS,
  quantizeEpaperLuminance
} from "../src/epaper-rendering";

describe("e-paper text edge conversion", () => {
  test("maps antialiased edge luminance to the nearest supported gray without dithering", () => {
    expect(EPAPER_LUMINANCE_LEVELS).toEqual([0, 85, 170, 255]);
    expect(
      [0, 42, 43, 127, 128, 212, 213, 255].map(quantizeEpaperLuminance)
    ).toEqual([0, 0, 85, 85, 170, 170, 255, 255]);
    expect(quantizeEpaperLuminance(128)).toBe(
      quantizeEpaperLuminance(128)
    );
  });

  test("uses heavy sans-serif strokes instead of fragile narrow or italic faces", () => {
    expect(DISPLAY_BASE_CSS).not.toMatch(/Arial Narrow|Georgia|italic/);
    expect(DISPLAY_BASE_CSS).toMatch(
      /font-family:\s*Arial,\s*Helvetica,\s*sans-serif/,
    );
    expect(DISPLAY_BASE_CSS).toMatch(/\.serif[\s\S]*font-weight:\s*900/);
  });
});

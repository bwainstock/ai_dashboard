import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { assertFourGrayPng } from "../src/png-contract";

function png(
  width = 800,
  height = 480,
  colors: Array<[number, number, number, number]> = [
    [0, 0, 0, 255],
    [85, 85, 85, 255],
    [170, 170, 170, 255],
    [255, 255, 255, 255]
  ]
): Uint8Array {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const color = colors[(offset / 4) % colors.length];
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = color[3];
  }
  return PNG.sync.write(image);
}

describe("published PNG contract", () => {
  test("accepts an opaque native-size image using the exact four-gray palette", async () => {
    await expect(assertFourGrayPng(png(), 1_000_000)).resolves.toEqual({
      width: 800,
      height: 480,
      byteSize: expect.any(Number),
      luminanceLevels: [0, 85, 170, 255]
    });
  });

  test.each([
    ["a fifth gray", png(800, 480, [[128, 128, 128, 255]])],
    ["arbitrary RGB color", png(800, 480, [[255, 0, 0, 255]])],
    ["alpha", png(800, 480, [[0, 0, 0, 254]])],
    ["wrong dimensions", png(799, 480)],
    ["oversized output", png(), 10]
  ])("rejects %s", async (_label, bytes, maximumBytes = 1_000_000) => {
    await expect(assertFourGrayPng(bytes, maximumBytes)).rejects.toThrow();
  });
});

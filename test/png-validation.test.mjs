import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";
import { test } from "vitest";
import {
  PngValidationError,
  validateOpaqueBinaryPng,
} from "../scripts/png-validation.mjs";

function png(width = 800, height = 480, tone = 255) {
  const image = new PNG({ width, height });
  for (let offset = 0; offset < image.data.length; offset += 4) {
    image.data[offset] = tone;
    image.data[offset + 1] = tone;
    image.data[offset + 2] = tone;
    image.data[offset + 3] = 255;
  }
  return PNG.sync.write(image);
}

test("shared PNG validation accepts configured opaque binary dimensions", () => {
  const bytes = png();
  const result = validateOpaqueBinaryPng(bytes, {
    width: 800,
    height: 480,
  });

  assert.deepEqual(result, {
    width: 800,
    height: 480,
    tones: new Set([255]),
  });
});

test.each([
  ["dimensions", png(799, 480), "dimensions"],
  ["palette", png(800, 480, 128), "palette"],
  ["decode", Buffer.from("not a png"), "decode"],
])("shared PNG validation rejects invalid %s", (_label, bytes, code) => {
  assert.throws(
    () => validateOpaqueBinaryPng(bytes, { width: 800, height: 480 }),
    (error) => error instanceof PngValidationError && error.code === code,
  );
});

test("shared PNG validation rejects transparency", () => {
  const image = new PNG({ width: 800, height: 480 });
  image.data.fill(255);
  image.data[3] = 0;

  assert.throws(
    () =>
      validateOpaqueBinaryPng(PNG.sync.write(image), {
        width: 800,
        height: 480,
      }),
    (error) => error instanceof PngValidationError && error.code === "opaque",
  );
});

test("shared PNG validation can require both binary tones", () => {
  assert.throws(
    () =>
      validateOpaqueBinaryPng(png(), {
        width: 800,
        height: 480,
        requireBothTones: true,
      }),
    (error) => error instanceof PngValidationError && error.code === "blank",
  );
});

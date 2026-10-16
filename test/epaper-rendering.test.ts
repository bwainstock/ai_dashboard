import { expect, test, vi } from "vitest";
import {
  captureEpaperPng,
  configureEpaperViewport,
  EPAPER_MONOCHROME_THRESHOLD
} from "../src/epaper-rendering";

test("captures at the native 800x480 device scale", async () => {
  const setViewport = vi.fn();

  await configureEpaperViewport({ setViewport } as never);

  expect(setViewport).toHaveBeenCalledWith({
    width: 800,
    height: 480,
    deviceScaleFactor: 1
  });
});

test("converts native pixels to the exact opaque binary palette at the stable threshold", async () => {
  const pixels = new Uint8ClampedArray([
    127, 127, 127, 255,
    128, 128, 128, 255
  ]);
  const putImageData = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    style: {},
    getContext: () => ({
      drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }),
      putImageData
    })
  };
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  vi.stubGlobal("Image", class {
    src = "";
    async decode(): Promise<void> {}
  });
  vi.stubGlobal("document", {
    createElement: () => canvas,
    documentElement: { style: {} },
    body: { style: {}, replaceChildren: vi.fn() }
  });

  const screenshot = vi
    .fn()
    .mockResolvedValueOnce("source")
    .mockResolvedValueOnce(new Uint8Array([1, 2, 3]));
  const evaluate = async <Result>(
    callback: (input: {
      sourcePng: string;
      width: number;
      height: number;
      threshold: number;
    }) => Result,
    input: {
      sourcePng: string;
      width: number;
      height: number;
      threshold: number;
    }
  ): Promise<Result> => callback(input);

  try {
    await expect(
      captureEpaperPng({ screenshot, evaluate } as never)
    ).resolves.toEqual(new Uint8Array([1, 2, 3]));
  } finally {
    vi.stubGlobal("document", previousDocument);
    vi.stubGlobal("Image", previousImage);
    vi.unstubAllGlobals();
  }

  expect(EPAPER_MONOCHROME_THRESHOLD).toBe(128);
  expect([...pixels]).toEqual([
    0, 0, 0, 255,
    255, 255, 255, 255
  ]);
  expect(putImageData).toHaveBeenCalledOnce();
});

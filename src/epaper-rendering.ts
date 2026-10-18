import type { Page } from "@cloudflare/puppeteer";
import {
  FOUR_GRAY_LUMINANCE_LEVELS,
  FOUR_GRAY_PNG_CONTRACT,
  FOUR_GRAY_QUANTIZED_LUMINANCE,
  quantizeFourGrayLuminance
} from "../shared/four-gray-contract.mjs";

const CAPTURE_SCALE = 1;

export const EPAPER_LUMINANCE_LEVELS = FOUR_GRAY_LUMINANCE_LEVELS;

export function quantizeEpaperLuminance(luminance: number): number {
  return quantizeFourGrayLuminance(luminance);
}

export async function configureEpaperViewport(page: Page): Promise<void> {
  await page.setViewport({
    width: FOUR_GRAY_PNG_CONTRACT.width,
    height: FOUR_GRAY_PNG_CONTRACT.height,
    deviceScaleFactor: CAPTURE_SCALE
  });
}

export async function captureEpaperPng(page: Page): Promise<Uint8Array> {
  const source = await page.screenshot({
    type: "png",
    fullPage: false,
    captureBeyondViewport: false,
    encoding: "base64"
  });

  await page.setViewport({
    width: FOUR_GRAY_PNG_CONTRACT.width,
    height: FOUR_GRAY_PNG_CONTRACT.height,
    deviceScaleFactor: 1
  });
  await page.evaluate(
    async ({ sourcePng, width, height, quantizedLuminance }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${sourcePng}`;
      await image.decode();

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const context = canvas.getContext("2d", {
        alpha: false,
        willReadFrequently: true
      });
      if (!context) throw new Error("Canvas rendering is unavailable");

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);

      const pixels = context.getImageData(0, 0, width, height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const offset = (y * width + x) * 4;
          const red = pixels.data[offset];
          const green = pixels.data[offset + 1];
          const blue = pixels.data[offset + 2];
          const alpha = pixels.data[offset + 3] / 255;
          const luminance =
            (0.2126 * red + 0.7152 * green + 0.0722 * blue) * alpha +
            255 * (1 - alpha);
          const output = quantizedLuminance[Math.round(luminance)];

          pixels.data[offset] = output;
          pixels.data[offset + 1] = output;
          pixels.data[offset + 2] = output;
          pixels.data[offset + 3] = 255;
        }
      }
      context.putImageData(pixels, 0, 0);

      document.documentElement.style.cssText =
        `width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#fff`;
      document.body.style.cssText =
        `width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#fff`;
      document.body.replaceChildren(canvas);
    },
    {
      sourcePng: source,
      width: FOUR_GRAY_PNG_CONTRACT.width,
      height: FOUR_GRAY_PNG_CONTRACT.height,
      quantizedLuminance: FOUR_GRAY_QUANTIZED_LUMINANCE
    }
  );

  return page.screenshot({
    type: "png",
    fullPage: false,
    captureBeyondViewport: false
  });
}

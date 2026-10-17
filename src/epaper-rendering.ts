import type { Page } from "@cloudflare/puppeteer";

const DISPLAY_WIDTH = 800;
const DISPLAY_HEIGHT = 480;
const CAPTURE_SCALE = 1;
const LUMINANCE_STEP = 85;

export const EPAPER_LUMINANCE_LEVELS = [0, 85, 170, 255] as const;

export function quantizeEpaperLuminance(luminance: number): number {
  const bounded = Math.max(0, Math.min(255, luminance));
  return Math.min(255, Math.round(bounded / LUMINANCE_STEP) * LUMINANCE_STEP);
}

export async function configureEpaperViewport(page: Page): Promise<void> {
  await page.setViewport({
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
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
    width: DISPLAY_WIDTH,
    height: DISPLAY_HEIGHT,
    deviceScaleFactor: 1
  });
  await page.evaluate(
    async ({ sourcePng, width, height, luminanceStep }) => {
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
          const output = Math.min(
            255,
            Math.round(luminance / luminanceStep) * luminanceStep
          );

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
      width: DISPLAY_WIDTH,
      height: DISPLAY_HEIGHT,
      luminanceStep: LUMINANCE_STEP
    }
  );

  return page.screenshot({
    type: "png",
    fullPage: false,
    captureBeyondViewport: false
  });
}

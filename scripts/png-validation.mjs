import { PNG } from "pngjs";

export class PngValidationError extends Error {
  /**
   * @param {"decode" | "dimensions" | "opaque" | "palette" | "blank"} code
   * @param {string} message
   * @param {{ width?: number, height?: number }} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PngValidationError";
    this.code = code;
    this.details = details;
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {{ width: number, height: number, requireBothTones?: boolean }} options
 * @returns {{ width: number, height: number, tones: Set<number> }}
 */
export function validateOpaqueBinaryPng(bytes, options) {
  let png;
  try {
    png = PNG.sync.read(Buffer.from(bytes));
  } catch (error) {
    throw new PngValidationError(
      "decode",
      error instanceof Error ? error.message : "decode failed"
    );
  }
  if (png.width !== options.width || png.height !== options.height) {
    throw new PngValidationError("dimensions", "unexpected PNG dimensions", {
      width: png.width,
      height: png.height
    });
  }

  const tones = new Set();
  for (let offset = 0; offset < png.data.length; offset += 4) {
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    const alpha = png.data[offset + 3];
    if (red !== green || green !== blue || alpha !== 255) {
      throw new PngValidationError(
        "opaque",
        "PNG contains color or transparency"
      );
    }
    if (red !== 0 && red !== 255) {
      throw new PngValidationError(
        "palette",
        "PNG contains pixels outside the binary palette"
      );
    }
    tones.add(red);
  }
  if (options.requireBothTones && tones.size < 2) {
    throw new PngValidationError("blank", "PNG does not contain both tones");
  }
  return { width: png.width, height: png.height, tones };
}

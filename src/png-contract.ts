import {
  FOUR_GRAY_PNG_CONTRACT,
  isFourGrayLuminance
} from "../shared/four-gray-contract.mjs";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export interface FourGrayPngInspection {
  width: number;
  height: number;
  byteSize: number;
  luminanceLevels: number[];
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3]
  );
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function unfilterScanlines(
  inflated: Uint8Array,
  width: number,
  height: number,
  bytesPerPixel: number
): Uint8Array {
  const stride = width * bytesPerPixel;
  if (inflated.byteLength !== height * (stride + 1)) {
    throw new Error("PNG pixel data has an unexpected size");
  }
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * (stride + 1);
    const targetOffset = y * stride;
    const filter = inflated[sourceOffset];
    if (filter > 4) throw new Error("PNG uses an unsupported row filter");
    for (let x = 0; x < stride; x += 1) {
      const raw = inflated[sourceOffset + 1 + x];
      const left = x >= bytesPerPixel ? pixels[targetOffset + x - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[targetOffset - stride + x] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[targetOffset - stride + x - bytesPerPixel]
          : 0;
      const predictor =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? above
              : filter === 3
                ? Math.floor((left + above) / 2)
                : paethPredictor(left, above, upperLeft);
      pixels[targetOffset + x] = (raw + predictor) & 0xff;
    }
  }
  return pixels;
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const compressed = new Uint8Array(bytes);
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function assertFourGrayPng(
  bytes: Uint8Array,
  maximumBytes: number,
  expectedWidth: number = FOUR_GRAY_PNG_CONTRACT.width,
  expectedHeight: number = FOUR_GRAY_PNG_CONTRACT.height
): Promise<FourGrayPngInspection> {
  if (bytes.byteLength > maximumBytes) {
    throw new Error(`PNG exceeds the ${maximumBytes}-byte device limit`);
  }
  if (
    bytes.byteLength < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    throw new Error("Image is not a PNG");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset: number = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  const imageData: Uint8Array[] = [];
  let reachedEnd = false;

  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const dataOffset = typeOffset + 4;
    const nextOffset = dataOffset + length + 4;
    if (nextOffset > bytes.byteLength) throw new Error("PNG chunk is truncated");
    const type = chunkType(bytes, typeOffset);
    if (type === "IHDR") {
      if (length !== 13 || width !== 0) throw new Error("PNG header is invalid");
      width = view.getUint32(dataOffset);
      height = view.getUint32(dataOffset + 4);
      bitDepth = bytes[dataOffset + 8];
      colorType = bytes[dataOffset + 9];
      if (
        bytes[dataOffset + 10] !== 0 ||
        bytes[dataOffset + 11] !== 0
      ) {
        throw new Error("PNG compression or filtering method is unsupported");
      }
      interlace = bytes[dataOffset + 12];
    } else if (type === "IDAT") {
      imageData.push(bytes.slice(dataOffset, dataOffset + length));
    } else if (type === "tRNS") {
      throw new Error("PNG contains transparency");
    } else if (type === "IEND") {
      reachedEnd = true;
      break;
    }
    offset = nextOffset;
  }

  if (!reachedEnd || width === 0 || height === 0 || imageData.length === 0) {
    throw new Error("PNG is incomplete");
  }
  if (width !== expectedWidth || height !== expectedHeight) {
    throw new Error(
      `PNG is ${width}x${height}; expected ${expectedWidth}x${expectedHeight}`
    );
  }
  if (bitDepth !== 8 || interlace !== 0) {
    throw new Error("PNG must use non-interlaced 8-bit channels");
  }
  const bytesPerPixel = new Map([
    [0, 1],
    [2, 3],
    [4, 2],
    [6, 4]
  ]).get(colorType);
  if (!bytesPerPixel) throw new Error("PNG color type is unsupported");

  const compressedLength = imageData.reduce(
    (total, chunk) => total + chunk.byteLength,
    0
  );
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const chunk of imageData) {
    compressed.set(chunk, compressedOffset);
    compressedOffset += chunk.byteLength;
  }
  const pixels = unfilterScanlines(
    await inflate(compressed),
    width,
    height,
    bytesPerPixel
  );
  const luminanceLevels = new Set<number>();

  for (let offset = 0; offset < pixels.byteLength; offset += bytesPerPixel) {
    const red = pixels[offset];
    const green = colorType === 0 || colorType === 4 ? red : pixels[offset + 1];
    const blue = colorType === 0 || colorType === 4 ? red : pixels[offset + 2];
    const alpha =
      colorType === 4
        ? pixels[offset + 1]
        : colorType === 6
          ? pixels[offset + 3]
          : 255;
    if (red !== green || green !== blue) {
      throw new Error("PNG contains non-neutral RGB color");
    }
    if (alpha !== FOUR_GRAY_PNG_CONTRACT.opaqueAlpha) {
      throw new Error("PNG contains transparency");
    }
    if (!isFourGrayLuminance(red)) {
      throw new Error("PNG contains pixels outside the four-gray palette");
    }
    luminanceLevels.add(red);
  }

  return {
    width,
    height,
    byteSize: bytes.byteLength,
    luminanceLevels: [...luminanceLevels].sort((left, right) => left - right)
  };
}

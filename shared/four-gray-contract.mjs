export const FOUR_GRAY_LUMINANCE_LEVELS = Object.freeze([0, 85, 170, 255]);

export const FOUR_GRAY_PNG_CONTRACT = Object.freeze({
  width: 800,
  height: 480,
  opaqueAlpha: 255,
  luminanceLevels: FOUR_GRAY_LUMINANCE_LEVELS
});

export const FOUR_GRAY_QUANTIZED_LUMINANCE = Object.freeze(
  Array.from({ length: FOUR_GRAY_PNG_CONTRACT.opaqueAlpha + 1 }, (_, luminance) =>
    FOUR_GRAY_LUMINANCE_LEVELS.reduce((nearest, level) =>
      Math.abs(level - luminance) <= Math.abs(nearest - luminance)
        ? level
        : nearest
    )
  )
);

export function isFourGrayLuminance(value) {
  return FOUR_GRAY_LUMINANCE_LEVELS.includes(value);
}

export function quantizeFourGrayLuminance(luminance) {
  const sourceValue = Math.round(
    Math.max(
      FOUR_GRAY_LUMINANCE_LEVELS[0],
      Math.min(FOUR_GRAY_PNG_CONTRACT.opaqueAlpha, luminance)
    )
  );
  return FOUR_GRAY_QUANTIZED_LUMINANCE[sourceValue];
}

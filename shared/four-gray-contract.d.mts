export const FOUR_GRAY_LUMINANCE_LEVELS: readonly number[];

export const FOUR_GRAY_PNG_CONTRACT: Readonly<{
  width: number;
  height: number;
  opaqueAlpha: number;
  luminanceLevels: typeof FOUR_GRAY_LUMINANCE_LEVELS;
}>;

export const FOUR_GRAY_QUANTIZED_LUMINANCE: readonly number[];

export function isFourGrayLuminance(value: number): boolean;

export function quantizeFourGrayLuminance(luminance: number): number;

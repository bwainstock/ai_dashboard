import configuredLimits from "../config/device-limits.json";

export const DEVICE_LIMITS = configuredLimits;

export function effectiveMaximumImageBytes(configured?: string): number {
  const parsed = Number(configured);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEVICE_LIMITS.maximumImageBytes;
  }
  return Math.min(parsed, DEVICE_LIMITS.maximumImageBytes);
}

export interface WeatherConfigurationInput {
  latitude: number;
  longitude: number;
  slots: string[];
}

export function normalizeWeatherConfiguration(
  value: unknown
): WeatherConfigurationInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as {
    latitude?: unknown;
    longitude?: unknown;
    slots?: unknown;
  };
  if (
    typeof input.latitude !== "number" ||
    input.latitude < -90 ||
    input.latitude > 90 ||
    typeof input.longitude !== "number" ||
    input.longitude < -180 ||
    input.longitude > 180 ||
    !Array.isArray(input.slots) ||
    input.slots.length < 1 ||
    new Set(input.slots).size !== input.slots.length ||
    input.slots.some(
      (slot) =>
        typeof slot !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot)
    )
  ) {
    return null;
  }
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    slots: [...input.slots].sort() as string[]
  };
}

export async function replaceWeatherConfiguration(
  db: D1Database,
  value: unknown
): Promise<WeatherConfigurationInput | null> {
  const input = normalizeWeatherConfiguration(value);
  if (!input) return null;
  await db
    .prepare(
      `UPDATE dashboard_configuration
       SET latitude = ?, longitude = ?, slots_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`
    )
    .bind(input.latitude, input.longitude, JSON.stringify(input.slots))
    .run();
  return input;
}

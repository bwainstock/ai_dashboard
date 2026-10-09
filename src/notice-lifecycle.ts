const DAY_MILLISECONDS = 24 * 60 * 60_000;
const DEFAULT_GRACE_DAYS = 3;
const MAXIMUM_GRACE_DAYS = 30;

export function noticeGraceDays(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAXIMUM_GRACE_DAYS
    ? parsed
    : DEFAULT_GRACE_DAYS;
}

export function noticeLifecycle(
  relevantDate: string | null,
  now: Date,
  configuredGraceDays: string | undefined
): { expiresAt: string; retainedUntil: string } {
  const baseExpiry = relevantDate
    ? new Date(`${relevantDate}T12:00:00.000Z`)
    : new Date(now.getTime() + 14 * DAY_MILLISECONDS);
  const expiresAt = new Date(
    baseExpiry.getTime() +
      noticeGraceDays(configuredGraceDays) * DAY_MILLISECONDS
  );
  return {
    expiresAt: expiresAt.toISOString(),
    retainedUntil: new Date(
      expiresAt.getTime() + 30 * DAY_MILLISECONDS
    ).toISOString()
  };
}

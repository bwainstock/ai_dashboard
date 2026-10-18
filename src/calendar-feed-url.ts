const MAXIMUM_CALENDAR_FEED_URL_LENGTH = 4096;

export function parseCalendarFeedUrl(value: unknown): URL | null {
  if (
    typeof value !== "string" ||
    value.length > MAXIMUM_CALENDAR_FEED_URL_LENGTH ||
    value !== value.trim() ||
    /\s/u.test(value)
  ) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    !url.hostname
  ) {
    return null;
  }
  return url;
}

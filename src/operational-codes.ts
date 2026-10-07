interface OperationalCodeMetadata {
  statusVisible: boolean;
  publicationBlocking: boolean;
  incident: boolean;
}

const code = (publicationBlocking = false) => ({
  statusVisible: true as const,
  publicationBlocking,
  incident: false as const
});

const incidentCode = () => ({
  statusVisible: true as const,
  publicationBlocking: false as const,
  incident: true as const
});

export const OPERATIONAL_CODES = {
  WEATHER_FETCH_FAILED: code(),
  WEATHER_UPSTREAM_HTTP: code(),
  WEATHER_UPSTREAM_NETWORK: code(),
  WEATHER_INVALID_RESPONSE: code(),
  LUNCH_UPSTREAM_HTTP: code(),
  LUNCH_UPSTREAM_NETWORK: code(),
  LUNCH_INVALID_RESPONSE: code(),
  CALENDAR_FETCH_FAILED: code(),
  CALENDAR_OAUTH_REVOKED: code(),
  CALENDAR_UPSTREAM_HTTP: code(),
  GMAIL_PROCESSING_FAILED: code(),
  GMAIL_OAUTH_REVOKED: code(),
  GMAIL_API_FAILED: code(),
  GMAIL_PROCESSOR_UNREACHABLE: code(),
  GOOGLE_ACCOUNT_CLEANUP_PENDING: code(),
  GOOGLE_REVOCATION_FAILED: code(),
  DAILY_BRIEF_RENDER_FAILED: code(true),
  CALENDAR_VIEW_RENDER_FAILED: code(true),
  LUNCH_VIEW_RENDER_FAILED: code(true),
  NOTICES_VIEW_RENDER_FAILED: code(true),
  RENDERED_IMAGE_INVALID: code(true),
  GENERATION_PUBLICATION_FAILED: code(true),
  AI_QUOTA_EXHAUSTED: incidentCode(),
  OAUTH_REVOKED_OR_EXPIRED: incidentCode(),
  SOURCE_SCHEDULED_FAILURE: incidentCode(),
  GMAIL_PROCESSING_REPEATED_FAILURE: incidentCode(),
  GENERATION_PUBLICATION_BLOCKED: incidentCode(),
  DEVICE_AUTH_SUSPICIOUS: incidentCode(),
  DEVICE_CHECK_IN_MISSING: incidentCode()
} as const satisfies Record<string, OperationalCodeMetadata>;

export type OperationalCode = keyof typeof OPERATIONAL_CODES;

export type IncidentCode = {
  [Code in OperationalCode]: (typeof OPERATIONAL_CODES)[Code]["incident"] extends true
    ? Code
    : never;
}[OperationalCode];

export function isOperationalCode(value: string): value is OperationalCode {
  return Object.hasOwn(OPERATIONAL_CODES, value);
}

export function statusSafeOperationalCode(
  value: string | null
): OperationalCode | null {
  return value &&
    isOperationalCode(value) &&
    OPERATIONAL_CODES[value].statusVisible
    ? value
    : null;
}

export function isPublicationBlockingOperationalCode(
  value: string
): boolean {
  return (
    isOperationalCode(value) && OPERATIONAL_CODES[value].publicationBlocking
  );
}

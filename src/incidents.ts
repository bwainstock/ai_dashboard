import {
  isPublicationBlockingOperationalCode,
  type IncidentCode
} from "./operational-codes";

export type { IncidentCode } from "./operational-codes";

export interface IncidentSnapshot {
  oauth: Array<{
    accountId: "mom" | "dad";
    state: "connected" | "disconnected" | "revoked" | "expired";
  }>;
  sources: Array<{
    source: "weather" | "calendar" | "lunch" | "gmail";
    consecutiveFailures: number;
  }>;
  aiQuota: "available" | "exhausted" | "not_applicable";
  latestGeneration: {
    state: "running" | "published" | "failed" | null;
    errorCode: string | null;
  };
  suspiciousDeviceAuthentication: boolean;
  device: {
    provisionedCount: number;
    provisionedAt: string | null;
    lastCheckInAt: string | null;
  };
}

export interface ActiveIncident {
  key: string;
  code: IncidentCode;
  occurredAt: string;
  notifiedAt: string | null;
}

export interface IncidentRepository {
  loadSnapshot(): Promise<IncidentSnapshot>;
  listActive(): Promise<ActiveIncident[]>;
  open(
    key: string,
    code: IncidentCode,
    occurredAt: string
  ): Promise<boolean>;
  markNotified(key: string, notifiedAt: string): Promise<void>;
  resolveExcept(keys: string[], resolvedAt: string): Promise<void>;
}

export type IncidentDelivery = (code: IncidentCode) => Promise<void>;

export interface OperationalIncidentEnv {
  DB: D1Database;
  INCIDENT_EMAIL?: SendEmail;
  OPERATIONAL_EMAIL_FROM?: string;
  OPERATIONAL_EMAIL_TO?: string;
}

export function operationalIncidentEmail(
  code: IncidentCode,
  from: string,
  to: string
): EmailMessageBuilder {
  return {
    from,
    to,
    subject: `Family Dashboard incident: ${code}`,
    text: `Family Dashboard incident ${code} requires action. Review the protected operational status page.`
  };
}

function desiredIncidents(
  snapshot: IncidentSnapshot,
  now: Date
): Array<{ key: string; code: IncidentCode }> {
  const desired: Array<{ key: string; code: IncidentCode }> = [];
  for (const account of snapshot.oauth) {
    if (account.state === "revoked" || account.state === "expired") {
      desired.push({
        key: `oauth:${account.accountId}`,
        code: "OAUTH_REVOKED_OR_EXPIRED"
      });
    }
  }
  for (const source of snapshot.sources) {
    if (source.consecutiveFailures >= 2) {
      desired.push({
        key: `source:${source.source}`,
        code:
          source.source === "gmail"
            ? "GMAIL_PROCESSING_REPEATED_FAILURE"
            : "SOURCE_SCHEDULED_FAILURE"
      });
    }
  }
  if (snapshot.aiQuota === "exhausted") {
    desired.push({ key: "ai:quota", code: "AI_QUOTA_EXHAUSTED" });
  }
  if (
    snapshot.latestGeneration.state === "failed" &&
    snapshot.latestGeneration.errorCode !== null &&
    isPublicationBlockingOperationalCode(
      snapshot.latestGeneration.errorCode
    )
  ) {
    desired.push({
      key: "generation:publication",
      code: "GENERATION_PUBLICATION_BLOCKED"
    });
  }
  if (snapshot.suspiciousDeviceAuthentication) {
    desired.push({
      key: "device:authentication",
      code: "DEVICE_AUTH_SUSPICIOUS"
    });
  }
  const lastActivityAt =
    snapshot.device.lastCheckInAt ?? snapshot.device.provisionedAt;
  const lastCheckIn = lastActivityAt
    ? new Date(lastActivityAt).getTime()
    : Number.NaN;
  if (
    snapshot.device.provisionedCount > 0 &&
    (!Number.isFinite(lastCheckIn) ||
      now.getTime() - lastCheckIn >= 24 * 60 * 60 * 1000)
  ) {
    desired.push({
      key: "device:check-in",
      code: "DEVICE_CHECK_IN_MISSING"
    });
  }
  return desired;
}

export async function evaluateOperationalIncidents(
  repository: IncidentRepository,
  deliver: IncidentDelivery,
  now: Date
): Promise<void> {
  const [snapshot, active] = await Promise.all([
    repository.loadSnapshot(),
    repository.listActive()
  ]);
  const desired = desiredIncidents(snapshot, now);
  const activeByKey = new Map(active.map((incident) => [incident.key, incident]));
  const occurredAt = now.toISOString();

  await repository.resolveExcept(
    desired.map(({ key }) => key),
    occurredAt
  );

  for (const incident of desired) {
    const current = activeByKey.get(incident.key);
    if (!current) {
      const opened = await repository.open(
        incident.key,
        incident.code,
        occurredAt
      );
      if (!opened) continue;
    } else if (current.notifiedAt !== null) {
      continue;
    }
    await deliver(incident.code);
    await repository.markNotified(incident.key, occurredAt);
  }
}

class D1IncidentRepository implements IncidentRepository {
  constructor(private readonly database: D1Database) {}

  async loadSnapshot(): Promise<IncidentSnapshot> {
    const [oauth, sources, quota, latestGeneration, device, authentication] =
      await Promise.all([
        this.database
          .prepare(
            `SELECT account_id, oauth_status
             FROM calendar_accounts ORDER BY account_id`
          )
          .all<{
            account_id: "mom" | "dad";
            oauth_status: "connected" | "disconnected" | "revoked";
          }>(),
        this.database
          .prepare(
            `SELECT source, consecutive_failures
             FROM source_status ORDER BY source`
          )
          .all<{
            source: "weather" | "calendar" | "lunch" | "gmail";
            consecutive_failures: number;
          }>(),
        this.database
          .prepare(
            `SELECT status_value FROM operational_status
             WHERE status_key = 'ai_quota'`
          )
          .first<{
            status_value: "available" | "exhausted" | "not_applicable";
          }>(),
        this.database
          .prepare(
            `SELECT status, error_code FROM scheduled_generation_slots
             ORDER BY started_at DESC LIMIT 1`
          )
          .first<{
            status: "running" | "published" | "failed";
            error_code: string | null;
          }>(),
        this.database
          .prepare(
            `SELECT COUNT(*) AS provisioned_count,
                    MIN(created_at) AS provisioned_at,
                    MAX(last_check_in_at) AS last_check_in_at
             FROM devices`
          )
          .first<{
            provisioned_count: number;
            provisioned_at: string | null;
            last_check_in_at: string | null;
          }>(),
        this.database
          .prepare(
            `SELECT active FROM operational_signals
             WHERE signal_key = 'device_auth_suspicious'`
          )
          .first<{ active: number }>()
      ]);
    return {
      oauth: oauth.results.map((account) => ({
        accountId: account.account_id,
        state: account.oauth_status
      })),
      sources: sources.results.map((source) => ({
        source: source.source,
        consecutiveFailures: source.consecutive_failures
      })),
      aiQuota: quota?.status_value ?? "not_applicable",
      latestGeneration: {
        state: latestGeneration?.status ?? null,
        errorCode: latestGeneration?.error_code ?? null
      },
      suspiciousDeviceAuthentication: authentication?.active === 1,
      device: {
        provisionedCount: Number(device?.provisioned_count ?? 0),
        provisionedAt: device?.provisioned_at ?? null,
        lastCheckInAt: device?.last_check_in_at ?? null
      }
    };
  }

  async listActive(): Promise<ActiveIncident[]> {
    const result = await this.database
      .prepare(
        `SELECT incident_key, error_code, occurred_at, notified_at
         FROM operational_incidents
         WHERE resolved_at IS NULL AND incident_key IS NOT NULL
         ORDER BY occurred_at`
      )
      .all<{
        incident_key: string;
        error_code: IncidentCode;
        occurred_at: string;
        notified_at: string | null;
      }>();
    return result.results.map((incident) => ({
      key: incident.incident_key,
      code: incident.error_code,
      occurredAt: incident.occurred_at,
      notifiedAt: incident.notified_at
    }));
  }

  async open(
    key: string,
    code: IncidentCode,
    occurredAt: string
  ): Promise<boolean> {
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO operational_incidents
           (incident_key, error_code, occurred_at)
         VALUES (?, ?, ?)`
      )
      .bind(key, code, occurredAt)
      .run();
    return (result.meta.changes ?? 0) > 0;
  }

  async markNotified(key: string, notifiedAt: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE operational_incidents SET notified_at = ?
         WHERE incident_key = ? AND resolved_at IS NULL`
      )
      .bind(notifiedAt, key)
      .run();
  }

  async resolveExcept(keys: string[], resolvedAt: string): Promise<void> {
    const condition =
      keys.length === 0
        ? ""
        : ` AND incident_key NOT IN (${keys.map(() => "?").join(", ")})`;
    await this.database
      .prepare(
        `UPDATE operational_incidents SET resolved_at = ?
         WHERE resolved_at IS NULL AND incident_key IS NOT NULL${condition}`
      )
      .bind(resolvedAt, ...keys)
      .run();
  }
}

export async function runOperationalIncidentCheck(
  env: OperationalIncidentEnv,
  now: Date
): Promise<void> {
  await evaluateOperationalIncidents(
    new D1IncidentRepository(env.DB),
    async (code) => {
      if (
        !env.INCIDENT_EMAIL ||
        !env.OPERATIONAL_EMAIL_FROM ||
        !env.OPERATIONAL_EMAIL_TO
      ) {
        throw new Error("Operational incident email is not configured");
      }
      await env.INCIDENT_EMAIL.send(
        operationalIncidentEmail(
          code,
          env.OPERATIONAL_EMAIL_FROM,
          env.OPERATIONAL_EMAIL_TO
        )
      );
    },
    now
  );
}

import { describe, expect, test, vi } from "vitest";
import {
  evaluateOperationalIncidents,
  type IncidentCode,
  type IncidentRepository,
  type IncidentSnapshot,
  operationalIncidentEmail
} from "../src/incidents";

const HEALTHY: IncidentSnapshot = {
  oauth: [
    { accountId: "mom", state: "connected" },
    { accountId: "dad", state: "connected" }
  ],
  sources: [
    { source: "weather", consecutiveFailures: 0 },
    { source: "calendar", consecutiveFailures: 0 },
    { source: "lunch", consecutiveFailures: 0 },
    { source: "gmail", consecutiveFailures: 0 }
  ],
  aiQuota: "available",
  latestGeneration: { state: "published", errorCode: null },
  suspiciousDeviceAuthentication: false,
  device: {
    provisionedCount: 1,
    provisionedAt: "2026-10-01T10:00:00.000Z",
    lastCheckInAt: "2026-10-07T10:00:00.000Z"
  }
};

class MemoryIncidentRepository implements IncidentRepository {
  snapshot: IncidentSnapshot = structuredClone(HEALTHY);
  readonly active = new Map<
    string,
    { code: IncidentCode; occurredAt: string; notifiedAt: string | null }
  >();

  async loadSnapshot() {
    return this.snapshot;
  }

  async listActive() {
    return [...this.active].map(([key, incident]) => ({ key, ...incident }));
  }

  async open(key: string, code: IncidentCode, occurredAt: string) {
    if (this.active.has(key)) return false;
    this.active.set(key, { code, occurredAt, notifiedAt: null });
    return true;
  }

  async markNotified(key: string, notifiedAt: string) {
    const incident = this.active.get(key);
    if (incident) incident.notifiedAt = notifiedAt;
  }

  async resolveExcept(keys: string[]) {
    for (const key of this.active.keys()) {
      if (!keys.includes(key)) this.active.delete(key);
    }
  }
}

describe("operational incident state machine", () => {
  test("builds operational email from fixed non-sensitive content only", () => {
    expect(
      operationalIncidentEmail(
        "DEVICE_AUTH_SUSPICIOUS",
        "dashboard@example.com",
        "operator@example.com"
      )
    ).toEqual({
      from: "dashboard@example.com",
      to: "operator@example.com",
      subject: "Family Dashboard incident: DEVICE_AUTH_SUSPICIOUS",
      text: "Family Dashboard incident DEVICE_AUTH_SUSPICIOUS requires action. Review the protected operational status page."
    });
  });

  test("delivers each actionable V1 incident once with fixed non-sensitive codes", async () => {
    const repository = new MemoryIncidentRepository();
    repository.snapshot = {
      oauth: [
        { accountId: "mom", state: "revoked" },
        { accountId: "dad", state: "connected" }
      ],
      sources: [
        { source: "weather", consecutiveFailures: 2 },
        { source: "calendar", consecutiveFailures: 0 },
        { source: "lunch", consecutiveFailures: 0 },
        { source: "gmail", consecutiveFailures: 2 }
      ],
      aiQuota: "exhausted",
      latestGeneration: {
        state: "failed",
        errorCode: "DAILY_BRIEF_RENDER_FAILED"
      },
      suspiciousDeviceAuthentication: true,
      device: {
        provisionedCount: 1,
        provisionedAt: "2026-10-01T10:00:00.000Z",
        lastCheckInAt: "2026-10-05T10:00:00.000Z"
      }
    };
    const deliver = vi.fn().mockResolvedValue(undefined);

    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:00:00.000Z")
    );
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:05:00.000Z")
    );

    expect(deliver.mock.calls.map(([code]) => code).sort()).toEqual(
      [
        "DEVICE_AUTH_SUSPICIOUS",
        "DEVICE_CHECK_IN_MISSING",
        "GENERATION_PUBLICATION_BLOCKED",
        "AI_QUOTA_EXHAUSTED",
        "OAUTH_REVOKED_OR_EXPIRED",
        "SOURCE_SCHEDULED_FAILURE",
        "GMAIL_PROCESSING_REPEATED_FAILURE"
      ].sort()
    );
    expect(deliver).toHaveBeenCalledTimes(7);
  });

  test("suppresses one transient source failure and duplicate active alerts", async () => {
    const repository = new MemoryIncidentRepository();
    repository.snapshot.sources[0] = {
      source: "weather",
      consecutiveFailures: 1
    };
    const deliver = vi.fn().mockResolvedValue(undefined);

    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:00:00.000Z")
    );
    repository.snapshot.sources[0].consecutiveFailures = 2;
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:05:00.000Z")
    );
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:10:00.000Z")
    );

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith("SOURCE_SCHEDULED_FAILURE");
  });

  test("recovery clears active state so a later recurrence alerts again", async () => {
    const repository = new MemoryIncidentRepository();
    const deliver = vi.fn().mockResolvedValue(undefined);
    repository.snapshot.oauth[0].state = "revoked";

    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:00:00.000Z")
    );
    repository.snapshot.oauth[0].state = "connected";
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:05:00.000Z")
    );
    expect(repository.active.size).toBe(0);

    repository.snapshot.oauth[0].state = "expired";
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:10:00.000Z")
    );

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver).toHaveBeenLastCalledWith("OAUTH_REVOKED_OR_EXPIRED");
  });

  test("Gmail failure and AI quota alerts clear on recovery and recur once", async () => {
    const repository = new MemoryIncidentRepository();
    const deliver = vi.fn().mockResolvedValue(undefined);
    const gmail = repository.snapshot.sources.find(
      ({ source }) => source === "gmail"
    )!;
    gmail.consecutiveFailures = 2;
    repository.snapshot.aiQuota = "exhausted";

    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:00:00.000Z")
    );
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:05:00.000Z")
    );
    gmail.consecutiveFailures = 0;
    repository.snapshot.aiQuota = "available";
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:10:00.000Z")
    );
    gmail.consecutiveFailures = 2;
    repository.snapshot.aiQuota = "exhausted";
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:15:00.000Z")
    );

    expect(deliver.mock.calls.map(([code]) => code)).toEqual([
      "GMAIL_PROCESSING_REPEATED_FAILURE",
      "AI_QUOTA_EXHAUSTED",
      "GMAIL_PROCESSING_REPEATED_FAILURE",
      "AI_QUOTA_EXHAUSTED"
    ]);
  });

  test("a failed delivery remains pending and is retried without opening a duplicate", async () => {
    const repository = new MemoryIncidentRepository();
    repository.snapshot.suspiciousDeviceAuthentication = true;
    const deliver = vi
      .fn()
      .mockRejectedValueOnce(new Error("email unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      evaluateOperationalIncidents(
        repository,
        deliver,
        new Date("2026-10-07T11:00:00.000Z")
      )
    ).rejects.toThrow("email unavailable");
    await evaluateOperationalIncidents(
      repository,
      deliver,
      new Date("2026-10-07T11:05:00.000Z")
    );

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(repository.active.size).toBe(1);
    expect([...repository.active.values()][0].notifiedAt).not.toBeNull();
  });
});

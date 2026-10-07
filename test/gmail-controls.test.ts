import { describe, expect, test, vi } from "vitest";
import {
  disconnectGoogleAccount,
  purgeExpiredGmailData,
  type GmailAccountDataRepository
} from "../src/gmail-controls";

class MemoryAccountRepository implements GmailAccountDataRepository {
  readonly deleted: string[] = [];
  state: "connected" | "revocation_pending" | "cleanup_pending" | "disconnected" =
    "connected";
  failDeletion = false;

  async beginDisconnect() {
    this.state = "revocation_pending";
  }

  async markRevokedForCleanup() {
    this.state = "cleanup_pending";
  }

  async deleteRetainedAccountData() {
    if (this.failDeletion) throw new Error("database unavailable");
    this.deleted.push("selected_calendars");
    this.deleted.push("calendar_snapshots");
    this.deleted.push("household_notices");
    this.deleted.push("gmail_protected_reviews");
    this.deleted.push("gmail_review_records");
    this.deleted.push("render_generations");
  }

  async completeDisconnectCleanup() {
    this.state = "disconnected";
  }
}

describe("Gmail account controls", () => {
  test("disconnect revokes Google access before deleting every retained account artifact", async () => {
    const repository = new MemoryAccountRepository();
    const revokeGoogleAccess = vi.fn().mockResolvedValue(undefined);
    const deletePrivateImages = vi.fn().mockResolvedValue(undefined);

    await expect(
      disconnectGoogleAccount(
      {
        accountId: "mom",
        refreshToken: "decrypted-refresh-token",
        state: "connected"
      },
      { repository, revokeGoogleAccess, deletePrivateImages }
      )
    ).resolves.toEqual({ status: "complete" });

    expect(revokeGoogleAccess).toHaveBeenCalledWith("decrypted-refresh-token");
    expect(repository.state).toBe("disconnected");
    expect(repository.deleted.sort()).toEqual(
      [
        "calendar_snapshots",
        "gmail_protected_reviews",
        "gmail_review_records",
        "household_notices",
        "render_generations",
        "selected_calendars"
      ].sort()
    );
    expect(deletePrivateImages).toHaveBeenCalledOnce();
  });

  test("failed revocation keeps retained data so the administrator can retry safely", async () => {
    const repository = new MemoryAccountRepository();

    await expect(
      disconnectGoogleAccount(
        { accountId: "dad", refreshToken: "token", state: "connected" },
        {
          repository,
          revokeGoogleAccess: vi
            .fn()
            .mockRejectedValue(new Error("revocation unavailable")),
          deletePrivateImages: vi.fn()
        }
      )
    ).rejects.toThrow("revocation unavailable");

    expect(repository.state).toBe("revocation_pending");
    expect(repository.deleted).toEqual([]);
  });

  test("an R2 failure still deletes local retained data and leaves durable cleanup pending", async () => {
    const repository = new MemoryAccountRepository();
    const revokeGoogleAccess = vi.fn().mockResolvedValue(undefined);
    const deletePrivateImages = vi
      .fn()
      .mockRejectedValue(new Error("R2 unavailable"));

    await expect(
      disconnectGoogleAccount(
        { accountId: "mom", refreshToken: "token", state: "connected" },
        { repository, revokeGoogleAccess, deletePrivateImages }
      )
    ).resolves.toEqual({
      status: "pending",
      errorCode: "GOOGLE_ACCOUNT_CLEANUP_PENDING"
    });

    expect(repository.state).toBe("cleanup_pending");
    expect(repository.deleted).not.toEqual([]);
    expect(JSON.stringify(await disconnectGoogleAccount(
      { accountId: "mom", refreshToken: null, state: "cleanup_pending" },
      {
        repository,
        revokeGoogleAccess,
        deletePrivateImages: vi.fn().mockResolvedValue(undefined)
      }
    ))).not.toMatch(/R2 unavailable|token|message/i);
    expect(revokeGoogleAccess).toHaveBeenCalledOnce();
    expect(repository.state).toBe("disconnected");
  });

  test("a D1 cleanup failure still attempts R2 and retries idempotently without revocation", async () => {
    const repository = new MemoryAccountRepository();
    repository.failDeletion = true;
    const revokeGoogleAccess = vi.fn().mockResolvedValue(undefined);
    const deletePrivateImages = vi.fn().mockResolvedValue(undefined);

    await expect(
      disconnectGoogleAccount(
        { accountId: "dad", refreshToken: "token", state: "connected" },
        { repository, revokeGoogleAccess, deletePrivateImages }
      )
    ).resolves.toEqual({
      status: "pending",
      errorCode: "GOOGLE_ACCOUNT_CLEANUP_PENDING"
    });
    expect(deletePrivateImages).toHaveBeenCalledOnce();
    expect(repository.state).toBe("cleanup_pending");

    repository.failDeletion = false;
    await expect(
      disconnectGoogleAccount(
        { accountId: "dad", refreshToken: null, state: "cleanup_pending" },
        { repository, revokeGoogleAccess, deletePrivateImages }
      )
    ).resolves.toEqual({ status: "complete" });

    expect(revokeGoogleAccess).toHaveBeenCalledOnce();
    expect(deletePrivateImages).toHaveBeenCalledTimes(2);
    expect(repository.state).toBe("disconnected");
  });

  test("maintenance purges accepted notices after retention and reviews after fourteen days", async () => {
    const purgeAccepted = vi.fn().mockResolvedValue(2);
    const purgeProtected = vi.fn().mockResolvedValue(3);
    const purgeFailures = vi.fn().mockResolvedValue(4);
    const now = new Date("2026-11-07T18:00:00.000Z");

    await expect(
      purgeExpiredGmailData(
        { purgeAccepted, purgeProtected, purgeFailures },
        now
      )
    ).resolves.toEqual({ accepted: 2, protected: 3, failures: 4 });
    expect(purgeAccepted).toHaveBeenCalledWith(now.toISOString());
    expect(purgeProtected).toHaveBeenCalledWith(now.toISOString());
    expect(purgeFailures).toHaveBeenCalledWith(now.toISOString());
  });
});

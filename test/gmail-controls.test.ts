import { describe, expect, test, vi } from "vitest";
import {
  disconnectGoogleAccount,
  purgeExpiredGmailData,
  type GmailAccountDataRepository
} from "../src/gmail-controls";

class MemoryAccountRepository implements GmailAccountDataRepository {
  readonly deleted: string[] = [];
  disconnected = false;

  async deleteRetainedDataAndDisconnect() {
    this.deleted.push("selected_calendars");
    this.deleted.push("calendar_snapshots");
    this.deleted.push("household_notices");
    this.deleted.push("gmail_protected_reviews");
    this.deleted.push("gmail_review_records");
    this.deleted.push("render_generations");
    this.disconnected = true;
  }
}

describe("Gmail account controls", () => {
  test("disconnect revokes Google access before deleting every retained account artifact", async () => {
    const repository = new MemoryAccountRepository();
    const revokeGoogleAccess = vi.fn().mockResolvedValue(undefined);
    const deletePrivateImages = vi.fn().mockResolvedValue(undefined);

    await disconnectGoogleAccount(
      {
        accountId: "mom",
        refreshToken: "decrypted-refresh-token"
      },
      { repository, revokeGoogleAccess, deletePrivateImages }
    );

    expect(revokeGoogleAccess).toHaveBeenCalledWith("decrypted-refresh-token");
    expect(repository.disconnected).toBe(true);
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
        { accountId: "dad", refreshToken: "token" },
        {
          repository,
          revokeGoogleAccess: vi
            .fn()
            .mockRejectedValue(new Error("revocation unavailable")),
          deletePrivateImages: vi.fn()
        }
      )
    ).rejects.toThrow("revocation unavailable");

    expect(repository.disconnected).toBe(false);
    expect(repository.deleted).toEqual([]);
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

export type GmailAccountId = "mom" | "dad";
export type GmailDisconnectState =
  | "connected"
  | "revocation_pending"
  | "cleanup_pending";

export interface GmailAccountDataRepository {
  beginDisconnect(accountId: GmailAccountId): Promise<void>;
  markRevokedForCleanup(accountId: GmailAccountId): Promise<void>;
  deleteRetainedAccountData(accountId: GmailAccountId): Promise<void>;
  completeDisconnectCleanup(accountId: GmailAccountId): Promise<void>;
}

export async function disconnectGoogleAccount(
  input: {
    accountId: GmailAccountId;
    refreshToken: string | null;
    state: GmailDisconnectState;
  },
  ports: {
    repository: GmailAccountDataRepository;
    revokeGoogleAccess(refreshToken: string): Promise<void>;
    deletePrivateImages(): Promise<void>;
  }
): Promise<
  | { status: "complete" }
  | { status: "pending"; errorCode: "GOOGLE_ACCOUNT_CLEANUP_PENDING" }
> {
  if (input.state !== "cleanup_pending") {
    if (!input.refreshToken) {
      throw new Error("Google account revocation cannot be resumed");
    }
    if (input.state === "connected") {
      await ports.repository.beginDisconnect(input.accountId);
    }
    await ports.revokeGoogleAccess(input.refreshToken);
    await ports.repository.markRevokedForCleanup(input.accountId);
  }

  const [databaseCleanup, imageCleanup] = await Promise.allSettled([
    ports.repository.deleteRetainedAccountData(input.accountId),
    ports.deletePrivateImages()
  ]);
  if (
    databaseCleanup.status === "rejected" ||
    imageCleanup.status === "rejected"
  ) {
    return {
      status: "pending",
      errorCode: "GOOGLE_ACCOUNT_CLEANUP_PENDING"
    };
  }
  try {
    await ports.repository.completeDisconnectCleanup(input.accountId);
  } catch {
    return {
      status: "pending",
      errorCode: "GOOGLE_ACCOUNT_CLEANUP_PENDING"
    };
  }
  return { status: "complete" };
}

export interface GmailRetentionRepository {
  purgeAccepted(cutoff: string): Promise<number>;
  purgeProtected(cutoff: string): Promise<number>;
  purgeFailures(cutoff: string): Promise<number>;
}

export async function purgeExpiredGmailData(
  repository: GmailRetentionRepository,
  now: Date
): Promise<{ accepted: number; protected: number; failures: number }> {
  const cutoff = now.toISOString();
  const [accepted, protectedCount, failures] = await Promise.all([
    repository.purgeAccepted(cutoff),
    repository.purgeProtected(cutoff),
    repository.purgeFailures(cutoff)
  ]);
  return { accepted, protected: protectedCount, failures };
}

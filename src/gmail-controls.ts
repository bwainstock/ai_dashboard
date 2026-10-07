export type GmailAccountId = "mom" | "dad";

export interface GmailAccountDataRepository {
  deleteRetainedDataAndDisconnect(accountId: GmailAccountId): Promise<void>;
}

export async function disconnectGoogleAccount(
  input: { accountId: GmailAccountId; refreshToken: string },
  ports: {
    repository: GmailAccountDataRepository;
    revokeGoogleAccess(refreshToken: string): Promise<void>;
    deletePrivateImages(): Promise<void>;
  }
): Promise<void> {
  await ports.revokeGoogleAccess(input.refreshToken);
  await ports.deletePrivateImages();
  await ports.repository.deleteRetainedDataAndDisconnect(input.accountId);
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

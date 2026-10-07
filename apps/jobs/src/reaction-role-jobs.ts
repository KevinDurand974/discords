export const reactionRoleCleanupScheduler = {
  id: "reaction-role-cleanup-hourly",
  repeat: { pattern: "0 * * * *" },
  template: {
    name: "reaction-role-cleanup",
    opts: {
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  },
};

export async function cleanReactionRoles(
  botUrl: string,
  token: string,
  request: typeof fetch = fetch,
) {
  const response = await request(`${botUrl}/internal/jobs/reaction-role-cleanup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`Reaction role cleanup returned HTTP ${response.status}`);
}

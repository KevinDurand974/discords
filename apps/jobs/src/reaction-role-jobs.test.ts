import { describe, expect, it, vi } from "vitest";
import { cleanReactionRoles, reactionRoleCleanupScheduler } from "./reaction-role-jobs.ts";

describe("reaction role hourly cleanup cron", () => {
  it("runs every hour with durable retries and bounded history", () => {
    expect(reactionRoleCleanupScheduler.repeat).toEqual({ pattern: "0 * * * *" });
    expect(reactionRoleCleanupScheduler.template.name).toBe("reaction-role-cleanup");
    expect(reactionRoleCleanupScheduler.template.opts).toEqual({
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  });
  it("calls the authenticated bot cleanup endpoint", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    await cleanReactionRoles("http://bot:3001", "secret", request);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "http://bot:3001/internal/jobs/reaction-role-cleanup",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        signal: expect.any(AbortSignal),
      },
    );
  });
  it.each([401, 500, 503])("reports HTTP %s failures for retry", async (status) => {
    await expect(
      cleanReactionRoles(
        "http://bot:3001",
        "secret",
        vi.fn(async () => new Response(null, { status })),
      ),
    ).rejects.toThrow(`HTTP ${status}`);
  });
  it("reports network failures for retry", async () => {
    await expect(
      cleanReactionRoles(
        "http://bot:3001",
        "secret",
        vi.fn(async () => {
          throw new Error("offline");
        }),
      ),
    ).rejects.toThrow("offline");
  });
});

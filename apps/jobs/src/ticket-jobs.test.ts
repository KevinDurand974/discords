import { describe, expect, it, vi } from "vitest";
import { closeDueTickets, ticketClosureScheduler } from "./ticket-jobs.ts";

describe("ticket closure cron", () => {
  it("checks every minute with durable retries and bounded job history", () => {
    expect(ticketClosureScheduler.repeat).toEqual({ pattern: "* * * * *" });
    expect(ticketClosureScheduler.template.name).toBe("ticket-closures");
    expect(ticketClosureScheduler.template.opts.attempts).toBe(3);
    expect(ticketClosureScheduler.template.opts.backoff).toEqual({
      type: "exponential",
      delay: 30_000,
    });
  });
  it("calls only the authenticated bot cleanup endpoint", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    await closeDueTickets("http://bot:3001", "secret", request);
    expect(request).toHaveBeenCalledExactlyOnceWith(
      "http://bot:3001/internal/jobs/ticket-closures",
      {
        method: "POST",
        headers: { Authorization: "Bearer secret" },
        signal: expect.any(AbortSignal),
      },
    );
  });
  it.each([401, 500, 503])("fails HTTP %s so BullMQ can retry", async (status) => {
    await expect(
      closeDueTickets(
        "http://bot:3001",
        "secret",
        vi.fn(async () => new Response(null, { status })),
      ),
    ).rejects.toThrow(`HTTP ${status}`);
  });
  it("fails network errors instead of silently dropping work", async () => {
    await expect(
      closeDueTickets(
        "http://bot:3001",
        "secret",
        vi.fn(async () => {
          throw new Error("Network unavailable");
        }),
      ),
    ).rejects.toThrow("Network unavailable");
  });
});

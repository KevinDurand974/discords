export const ticketClosureScheduler = {
  id: "ticket-closures-every-minute",
  repeat: { pattern: "* * * * *" },
  template: {
    name: "ticket-closures",
    opts: {
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  },
};

export async function closeDueTickets(
  botUrl: string,
  token: string,
  request: typeof fetch = fetch,
) {
  const response = await request(`${botUrl}/internal/jobs/ticket-closures`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!response.ok) throw new Error(`Ticket closures returned HTTP ${response.status}`);
}

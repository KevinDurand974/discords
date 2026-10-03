export const youtubeScheduler = {
  id: "youtube-refresh-every-10-minutes",
  repeat: { pattern: "*/10 * * * *" },
  template: {
    name: "youtube-refresh",
    opts: {
      attempts: 3,
      backoff: { type: "exponential" as const, delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  },
};

/** Always publish already-persisted work, even if some or all upstream feeds failed. */
export async function refreshYoutube(
  apiUrl: string,
  botUrl: string,
  token: string,
  request: typeof fetch = fetch,
) {
  const headers = { Authorization: `Bearer ${token}` };
  const failures: string[] = [];
  try {
    const response = await request(`${apiUrl}/internal/jobs/youtube-ingestion`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok) failures.push(`ingestion HTTP ${response.status}`);
    else {
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("complete" in result) ||
        result.complete !== true
      )
        failures.push("incomplete ingestion");
    }
  } catch {
    failures.push("ingestion unavailable");
  }
  try {
    const response = await request(`${botUrl}/internal/jobs/youtube-publication`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok) failures.push(`publication HTTP ${response.status}`);
  } catch {
    failures.push("publication unavailable");
  }
  if (failures.length) throw new Error(`YouTube refresh failed: ${failures.join(", ")}`);
}

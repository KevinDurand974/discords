export function createPublicRateLimiter(limit = 120, windowMs = 60_000) {
  const hits = new Map<string, { count: number; resetsAt: number }>();
  return (address: string, now = Date.now()) => {
    if (hits.size > 10_000) {
      hits.forEach((entry, key) => {
        if (entry.resetsAt <= now) hits.delete(key);
      });
    }
    const previous = hits.get(address);
    const entry =
      previous && previous.resetsAt > now
        ? { count: previous.count + 1, resetsAt: previous.resetsAt }
        : { count: 1, resetsAt: now + windowMs };
    hits.set(address, entry);
    return entry.count > limit ? Math.ceil((entry.resetsAt - now) / 1000) : 0;
  };
}

export function corsHeaders(origin: string | null, allowedOrigins: readonly string[]) {
  return origin && allowedOrigins.includes(origin)
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {};
}

import { parseYoutubeFeed, MAX_FEED_BYTES } from "./rss-parser.ts";
import { CHANNEL_ID_PATTERN, YoutubeError, type YoutubeClient } from "./types.ts";

export type YoutubeClientOptions = {
  apiKey?: string | undefined;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

const TRANSPORT_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT",
  "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);
function transportCode(error: unknown): string | null {
  for (let depth = 0; depth < 3; depth++) {
    if (!error || typeof error !== "object") return null;
    if ("code" in error && typeof error.code === "string" && TRANSPORT_CODES.has(error.code))
      return error.code;
    error = "cause" in error ? error.cause : undefined;
  }
  return null;
}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel();
    throw new YoutubeError("response_too_large", "YouTube response exceeds the size limit.", 413);
  }
  if (!response.body) throw new YoutubeError("empty_response", "YouTube returned an empty response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let result = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new YoutubeError("response_too_large", "YouTube response exceeds the size limit.", 413);
      }
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

export function createYoutubeClient(options: YoutubeClientOptions = {}): YoutubeClient {
  const fetcher = options.fetch ?? globalThis.fetch;
  async function request(url: URL, maxBytes: number, source: "google" | "rss") {
    const startedAt = performance.now();
    let upstreamStatus: number | null = null;
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        redirect: "error",
        headers: { Accept: source === "rss" ? "application/atom+xml, application/xml" : "application/json" },
      });
      upstreamStatus = response.status;
      if (!response.ok) await response.body?.cancel();
      if (response.status === 404 && source === "rss")
        throw new YoutubeError("channel_not_found", "YouTube channel feed not found.", 404);
      if (source === "google" && [400, 401, 403, 429].includes(response.status))
        throw new YoutubeError("google_access_denied", "YouTube API key was rejected or its quota is exhausted.", 503);
      if (!response.ok)
        throw new YoutubeError("upstream_unavailable", "YouTube is temporarily unavailable.", 502);
      return await readBounded(response, maxBytes);
    } catch (error) {
      const failure = error instanceof YoutubeError ? error
        : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
          ? new YoutubeError("upstream_timeout", "YouTube request timed out.", 503)
          : new YoutubeError("upstream_unavailable", "YouTube request failed.", 502);
      // TEMPORARY: never log raw errors, URLs or bodies; upstream errors can contain the API key.
      console.warn("[DEBUG-youtube-upstream]", {
        source,
        upstream_status: upstreamStatus,
        error_code: failure.code,
        transport_code: transportCode(error),
        elapsed_ms: Math.round(performance.now() - startedAt),
      });
      throw failure;
    }
  }
  return {
    async resolve(input) {
      if (input.kind === "id") return input.channelId;
      if (!options.apiKey)
        throw new YoutubeError("missing_api_key", "Configure YOUTUBE_API_KEY in the API to resolve handles.", 503);
      const url = new URL("https://www.googleapis.com/youtube/v3/channels");
      url.search = new URLSearchParams({
        part: "contentDetails", forHandle: input.handle, key: options.apiKey,
      }).toString();
      const body = await request(url, 262_144, "google");
      let data: unknown;
      try { data = JSON.parse(body); } catch {
        throw new YoutubeError("invalid_google_response", "YouTube returned invalid channel JSON.");
      }
      if (!data || typeof data !== "object" || !("items" in data) || !Array.isArray(data.items))
        throw new YoutubeError("invalid_google_response", "YouTube returned invalid channel data.");
      if (!data.items.length)
        throw new YoutubeError("channel_not_found", "No YouTube channel matches this handle.", 404);
      const first: unknown = data.items[0];
      if (!first || typeof first !== "object" || !("id" in first) ||
          typeof first.id !== "string" || !CHANNEL_ID_PATTERN.test(first.id))
        throw new YoutubeError("invalid_google_response", "YouTube returned an invalid channel ID.");
      return first.id;
    },
    async feed(channelId) {
      if (!CHANNEL_ID_PATTERN.test(channelId))
        throw new YoutubeError("invalid_channel_id", "Invalid YouTube channel ID.", 400);
      const url = new URL("https://www.youtube.com/feeds/videos.xml");
      url.searchParams.set("channel_id", channelId);
      return parseYoutubeFeed(await request(url, MAX_FEED_BYTES, "rss"), channelId);
    },
  };
}

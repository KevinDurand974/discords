import { parseYoutubeFeed, MAX_FEED_BYTES } from "./rss-parser.ts";
import { CHANNEL_ID_PATTERN, YoutubeError, type YoutubeClient } from "./types.ts";

export type YoutubeClientOptions = {
  apiKey?: string | undefined;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

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
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        redirect: "error",
        headers: { Accept: source === "rss" ? "application/atom+xml, application/xml" : "application/json" },
      });
      if (!response.ok) await response.body?.cancel();
      if (response.status === 404 && source === "rss")
        throw new YoutubeError("channel_not_found", "YouTube channel feed not found.", 404);
      if (source === "google" && [400, 401, 403, 429].includes(response.status))
        throw new YoutubeError("google_access_denied", "YouTube API key was rejected or its quota is exhausted.", 503);
      if (!response.ok)
        throw new YoutubeError("upstream_unavailable", "YouTube is temporarily unavailable.", 502);
      return await readBounded(response, maxBytes);
    } catch (error) {
      if (error instanceof YoutubeError) throw error;
      // Never forward errors/cause/request URLs: Google URLs contain the API key.
      if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name))
        throw new YoutubeError("upstream_timeout", "YouTube request timed out.", 503);
      throw new YoutubeError("upstream_unavailable", "YouTube request failed.", 502);
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

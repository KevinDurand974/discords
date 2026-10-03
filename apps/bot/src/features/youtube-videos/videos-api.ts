import { FetchError, ofetch } from "ofetch";

function resolutionError(error: unknown): string {
  if (error instanceof FetchError) {
    if (error.statusCode === 401)
      return "API service authentication failed. NEWS_INTERNAL_TOKEN must match in the bot and API; restart both applications after updating it.";
    // Whitelist fixed messages; never forward raw HTTP errors, request URLs or source text.
    const code: unknown = error.data?.code;
    if (code === "invalid_feed")
      return "YouTube returned an invalid RSS feed. Check the API version and source feed, then retry.";
    if (code === "missing_api_key")
      return "YOUTUBE_API_KEY is missing from the API. Configure it and restart the API, or use a direct UC channel ID.";
  }
  return "YouTube channel could not be resolved. Check the channel URL/ID, API key and API availability, then retry.";
}

export type ResolvedCreator = {
  channel: { channelId: string; displayName: string };
  videos: { videoId: string; publishedAt: string }[];
};
export function createVideosApi(base: string, token: string | undefined) {
  const url = new URL(base);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("YOUTUBE_API_URL must use HTTP(S).");
  return {
    async resolve(channelUrl: string): Promise<ResolvedCreator> {
      if (!token) throw new Error("NEWS_INTERNAL_TOKEN is required for YouTube resolution.");
      try {
        const result = await ofetch<ResolvedCreator>(
          new URL("/internal/youtube/channels/resolve", url).href,
          {
            method: "POST",
            body: { channelUrl },
            headers: { Authorization: `Bearer ${token}` },
            timeout: 45_000,
            retry: 0,
          },
        );
        if (
          !/^UC[A-Za-z0-9_-]{22}$/.test(result.channel?.channelId) ||
          typeof result.channel.displayName !== "string" ||
          !Array.isArray(result.videos) ||
          result.videos.some(
            (video) =>
              !/^[A-Za-z0-9_-]{11}$/.test(video.videoId) ||
              !Number.isFinite(Date.parse(video.publishedAt)),
          )
        )
          throw new Error("Invalid response");
        return result;
      } catch (error) {
        throw new Error(resolutionError(error));
      }
    },
  };
}

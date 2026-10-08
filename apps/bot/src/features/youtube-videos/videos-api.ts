import { UserFacingError } from "@/core/errors.ts";
import { FetchError, ofetch } from "ofetch";

function resolutionError(error: unknown): string {
  if (error instanceof FetchError) {
    if (error.statusCode === 401)
      return "YouTube is unavailable. Ask an administrator to check the YouTube service.";
    // Whitelist fixed messages; never forward raw HTTP errors, request URLs or source text.
    const code: unknown = error.data?.code;
    if (code === "invalid_feed")
      return "Couldn't load this creator's videos. Check the channel URL or ID, then try again.";
    if (code === "missing_api_key")
      return "Channel search is unavailable. Try a direct YouTube channel ID or contact an administrator.";
  }
  return "Couldn't find this YouTube channel. Check its URL or ID, then try again.";
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
        throw new UserFacingError(resolutionError(error), { cause: error });
      }
    },
  };
}

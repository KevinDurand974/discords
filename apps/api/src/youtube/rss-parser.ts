import { XMLParser, XMLValidator } from "fast-xml-parser";
import { CHANNEL_ID_PATTERN, VIDEO_ID_PATTERN, YoutubeError, type YoutubeFeed, type YoutubeVideo } from "./types.ts";

export const MAX_FEED_BYTES = 1_048_576;
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: true,
  // fast-xml-parser enables numeric character references through this option.
  htmlEntities: true,
  isArray: (_name, path) => path === "feed.entry" || path === "feed.entry.link",
});

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const array = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value];
const invalid = () => new YoutubeError("invalid_feed", "YouTube returned an invalid RSS feed.");

function date(value: unknown): string {
  const raw = text(value);
  if (!raw || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(raw) ||
      !Number.isFinite(Date.parse(raw)) ||
      new Date(`${raw.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) !== raw.slice(0, 10)) throw invalid();
  return new Date(raw).toISOString();
}

function parseEntry(value: unknown, channelId: string): YoutubeVideo {
  const entry = object(value);
  const sourceEntryId = text(entry.id);
  const videoId = text(entry["yt:videoId"]) ?? sourceEntryId?.replace(/^yt:video:/, "");
  const group = object(entry["media:group"]);
  const title = text(group["media:title"]) ?? text(entry.title);
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId) || sourceEntryId !== `yt:video:${videoId}` ||
      text(entry["yt:channelId"]) !== channelId || !title?.trim()) throw invalid();
  const link = array(entry.link).map(object).find((item) => item["@_rel"] === "alternate");
  const href = text(link?.["@_href"]);
  if (!href) throw invalid();
  const url = new URL(href);
  if (url.protocol !== "https:" || !["www.youtube.com", "youtube.com"].includes(url.hostname) ||
      url.username || url.password || url.port || url.pathname !== "/watch" ||
      url.searchParams.get("v") !== videoId) throw invalid();
  const description = text(group["media:description"]);
  if (group["media:description"] !== undefined && description === undefined) throw invalid();
  return {
    videoId, channelId, sourceEntryId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title, description: description ?? "",
    publishedAt: date(entry.published),
    sourceUpdatedAt: entry.updated === undefined ? null : date(entry.updated),
  };
}

export function parseYoutubeFeed(xml: string, channelId: string): YoutubeFeed {
  if (!CHANNEL_ID_PATTERN.test(channelId)) throw invalid();
  if (Buffer.byteLength(xml, "utf8") > MAX_FEED_BYTES)
    throw new YoutubeError("response_too_large", "YouTube RSS response exceeds the size limit.", 413);
  // Disable document-defined entities/XXE entirely, but retain standard text entities.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw invalid();
  let data: Record<string, unknown>;
  try { data = object(parser.parse(xml)); } catch { throw invalid(); }
  const feed = object(data.feed);
  const displayName = text(feed.title)?.trim();
  // Real YouTube feeds may omit UC on the root ID, while video entries retain it.
  const rootChannelId = text(feed["yt:channelId"]);
  if (!displayName || (rootChannelId !== channelId && `UC${rootChannelId}` !== channelId) ||
      feed["@_xmlns"] !== "http://www.w3.org/2005/Atom" ||
      feed["@_xmlns:yt"] !== "http://www.youtube.com/xml/schemas/2015") throw invalid();
  const entries = array(feed.entry);
  const valid = entries.map((entry) => {
    try { return parseEntry(entry, channelId); } catch { return undefined; }
  });
  const videos = valid.filter((entry) => entry !== undefined);
  // Reject conflicting duplicate source identifiers instead of silently picking metadata.
  const unique = new Map(videos.map((video) => [video.videoId, video]));
  if (unique.size !== videos.length) throw invalid();
  return { channelId, displayName, videos, rejectedEntries: entries.length - videos.length };
}

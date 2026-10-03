import { CHANNEL_ID_PATTERN, YoutubeError, type ChannelInput } from "./types.ts";

const invalid = () => new YoutubeError(
  "invalid_channel_input",
  "Use a YouTube @handle or UC channel ID, or its https://www.youtube.com channel URL.",
  400,
);

function fromHandle(handle: string): ChannelInput {
  // Keep international handles intact; source existence is checked by Google.
  if (!handle.startsWith("@") || handle.length < 2 || handle.length > 101 ||
      /[\s\p{Cc}\/\\?#%@:]/u.test(handle.slice(1))) throw invalid();
  return { kind: "handle", handle, canonicalUrl: `https://www.youtube.com/${encodeURI(handle)}` };
}

function fromId(channelId: string): ChannelInput {
  if (!CHANNEL_ID_PATTERN.test(channelId)) throw invalid();
  return { kind: "id", channelId, canonicalUrl: `https://www.youtube.com/channel/${channelId}` };
}

export function parseChannelInput(value: string): ChannelInput {
  const input = value.trim();
  if (!input || input.length > 2048) throw invalid();
  if (input.startsWith("@")) return fromHandle(input);
  if (input.startsWith("UC")) return fromId(input);
  try {
    // Reject URL-parser normalization of unsafe backslashes/control characters.
    if (/[\\\p{Cc}]/u.test(input)) throw invalid();
    const url = new URL(input);
    if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com"].includes(url.hostname) ||
        url.username || url.password || url.port) throw invalid();
    const path = decodeURIComponent(url.pathname);
    const handle = /^\/(@[^/]+)\/?$/.exec(path)?.[1];
    if (handle) return fromHandle(handle);
    const id = /^\/channel\/([^/]+)\/?$/.exec(path)?.[1];
    if (id) return fromId(id);
    throw invalid();
  } catch {
    throw invalid();
  }
}

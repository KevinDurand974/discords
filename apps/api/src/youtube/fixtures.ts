// Source fixtures shared by parser/client and PostgreSQL tests; no live YouTube requests.
export const CHANNEL_ID = "UCEhHNuc4TzD33XrXVgG7aiQ";
export const OTHER_CHANNEL_ID = "UCaaaaaaaaaaaaaaaaaaaaaa";

export const videoId = (index: number) => `video${String(index).padStart(6, "0")}`;
export function rssEntry(index: number, overrides: { title?: string; description?: string; published?: string } = {}) {
  const id = videoId(index);
  return `<entry><id>yt:video:${id}</id><yt:videoId>${id}</yt:videoId><yt:channelId>${CHANNEL_ID}</yt:channelId>
<title>Fallback ${index}</title><link rel="self" href="https://www.youtube.com/feeds/videos.xml"/>
<link rel="alternate" href="https://www.youtube.com/watch?v=${id}"/>
<published>${overrides.published ?? `2026-10-${String(index).padStart(2, "0")}T01:21:28+00:00`}</published>
<updated>2026-10-20T01:21:28+00:00</updated><media:group>
<media:title>${overrides.title ?? `Guide ${index}`}</media:title>
<media:description>${overrides.description ?? "Stats &amp; cores &#33;"}</media:description>
</media:group></entry>`;
}
export function rssFixture(count = 15) {
  return wrapFeed(Array.from({ length: count }, (_, index) => rssEntry(index + 1)).join(""));
}
export function wrapFeed(entries: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"
xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
<yt:channelId>${CHANNEL_ID}</yt:channelId><title>Heartful Harry</title>${entries}</feed>`;
}

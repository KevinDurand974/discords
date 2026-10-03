import { describe, expect, it } from "vitest";
import { MAX_FEED_BYTES, parseYoutubeFeed } from "./rss-parser.ts";
import { CHANNEL_ID, OTHER_CHANNEL_ID, rssEntry, rssFixture, videoId, wrapFeed } from "./fixtures.ts";

describe("YouTube RSS normalization", () => {
  it("stores all fifteen entries and reads namespaced media fields/alternate link attributes", () => {
    const feed = parseYoutubeFeed(rssFixture(), CHANNEL_ID);
    expect(feed.displayName).toBe("Heartful Harry");
    expect(feed.videos).toHaveLength(15);
    expect(feed.rejectedEntries).toBe(0);
    expect(feed.videos[0]).toEqual({
      channelId: CHANNEL_ID, videoId: videoId(1), sourceEntryId: `yt:video:${videoId(1)}`,
      url: `https://www.youtube.com/watch?v=${videoId(1)}`,
      title: "Guide 1", description: "Stats & cores !", publishedAt: "2026-10-01T01:21:28.000Z",
      sourceUpdatedAt: "2026-10-20T01:21:28.000Z",
    });
  });
  it("accepts YouTube's prefixless root channel ID while entries keep the canonical UC ID", () => {
    const xml = rssFixture(1).replace(`<yt:channelId>${CHANNEL_ID}</yt:channelId>`, `<yt:channelId>${CHANNEL_ID.slice(2)}</yt:channelId>`);
    const feed = parseYoutubeFeed(xml, CHANNEL_ID);
    expect(feed.channelId).toBe(CHANNEL_ID);
    expect(feed.videos).toHaveLength(1);
    expect(feed.rejectedEntries).toBe(0);
    expect(feed.videos[0]!.channelId).toBe(CHANNEL_ID);
    expect(() => parseYoutubeFeed(xml.replace(CHANNEL_ID.slice(2), OTHER_CHANNEL_ID.slice(2)), CHANNEL_ID)).toThrow("invalid RSS feed");
  });
  it("accepts empty feeds and singleton entries, preserving text and empty descriptions", () => {
    expect(parseYoutubeFeed(rssFixture(0), CHANNEL_ID).videos).toEqual([]);
    const feed = parseYoutubeFeed(wrapFeed(rssEntry(1, { title: "001", description: "" })), CHANNEL_ID);
    expect(feed.videos).toHaveLength(1);
    expect(feed.videos[0]).toMatchObject({ title: "001", description: "" });
    const cdata = parseYoutubeFeed(wrapFeed(rssEntry(1, { description: "<![CDATA[<b>raw text</b> @everyone]]>" })), CHANNEL_ID);
    expect(cdata.videos[0]?.description).toBe("<b>raw text</b> @everyone");
  });
  it("falls back to entry title and video entry ID and permits absent updated/description", () => {
    const entry = rssEntry(1).replace(/<media:title>.*?<\/media:title>/, "")
      .replace(/<yt:videoId>.*?<\/yt:videoId>/, "")
      .replace(/<updated>.*?<\/updated>/, "").replace(/<media:description>.*?<\/media:description>/, "");
    expect(parseYoutubeFeed(wrapFeed(entry), CHANNEL_ID).videos[0]).toMatchObject({
      title: "Fallback 1", videoId: videoId(1), sourceUpdatedAt: null, description: "",
    });
  });
  it("rejects bad entries independently, without losing valid entries", () => {
    const feed = parseYoutubeFeed(wrapFeed(rssEntry(1) + rssEntry(2, { published: "not a date" }) +
      rssEntry(3).replace(`v=${videoId(3)}`, `v=${videoId(4)}`) +
      rssEntry(4).replace(`<yt:channelId>${CHANNEL_ID}`, `<yt:channelId>${OTHER_CHANNEL_ID}`)), CHANNEL_ID);
    expect(feed.videos.map(({ videoId: id }) => id)).toEqual([videoId(1)]);
    expect(feed.rejectedEntries).toBe(3);
  });
  it.each(["2026-02-30T01:00:00Z", "2026-10-01T24:00:00Z", "2026-10-01"])("rejects invalid calendar dates/times: %s", (published) => {
    const feed = parseYoutubeFeed(wrapFeed(rssEntry(1, { published })), CHANNEL_ID);
    expect(feed.videos).toEqual([]);
    expect(feed.rejectedEntries).toBe(1);
  });
  it.each([
    "<feed>", "<html>Unavailable</html>",
    `<!DOCTYPE feed [<!ENTITY leak SYSTEM 'file:///etc/passwd'>]>${rssFixture(0)}`,
    `<!DOCTYPE feed [<!ENTITY a 'ha'><!ENTITY b '&a;&a;'>]>${rssFixture(0)}`,
    rssFixture(0).replace(CHANNEL_ID, OTHER_CHANNEL_ID),
    rssFixture(0).replace("http://www.w3.org/2005/Atom", "https://evil.test/atom"),
  ])("rejects malformed/unsafe feed structures", (xml) => {
    expect(() => parseYoutubeFeed(xml, CHANNEL_ID)).toThrow("invalid RSS feed");
  });
  it("rejects oversized documents and duplicate video IDs", () => {
    expect(() => parseYoutubeFeed("x".repeat(MAX_FEED_BYTES + 1), CHANNEL_ID)).toThrow("size limit");
    expect(() => parseYoutubeFeed(wrapFeed(rssEntry(1) + rssEntry(1)), CHANNEL_ID)).toThrow("invalid RSS feed");
  });
});

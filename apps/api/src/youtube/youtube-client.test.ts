import { describe, expect, it, vi } from "vitest";
import { parseChannelInput } from "./channel-url.ts";
import { createYoutubeClient } from "./youtube-client.ts";
import { CHANNEL_ID, rssFixture } from "./fixtures.ts";

const mockFetch = (body: string, status = 200) => vi.fn<typeof fetch>(async () => new Response(body, { status }));

describe("YouTube source client", () => {
  it("looks up handles using the Google contract and parses items[0].id", async () => {
    const fetcher = mockFetch(JSON.stringify({ items: [{ id: CHANNEL_ID }] }));
    const client = createYoutubeClient({ apiKey: "private-key", fetch: fetcher });
    expect(await client.resolve(parseChannelInput("@heartfulharry2185"))).toBe(CHANNEL_ID);
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/channels");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      part: "contentDetails", forHandle: "@heartfulharry2185", key: "private-key",
    });
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
  });
  it("bypasses Google for direct IDs without an API key, then fetches RSS", async () => {
    const fetcher = mockFetch(rssFixture());
    const client = createYoutubeClient({ fetch: fetcher });
    expect(await client.resolve(parseChannelInput(CHANNEL_ID))).toBe(CHANNEL_ID);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await client.feed(CHANNEL_ID)).videos).toHaveLength(15);
    expect(String(fetcher.mock.calls[0]![0])).toBe(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
  });
  it("rejects handle lookup without a key before making any request", async () => {
    const fetcher = mockFetch("{}");
    await expect(createYoutubeClient({ fetch: fetcher }).resolve(parseChannelInput("@creator")))
      .rejects.toMatchObject({ code: "missing_api_key", status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    ["{bad", 200, "invalid_google_response"], ["{}", 200, "invalid_google_response"],
    ['{"items":[]}', 200, "channel_not_found"], ['{"items":[{"id":"bad"}]}', 200, "invalid_google_response"],
    ["forbidden private-key", 403, "google_access_denied"], ["quota private-key", 429, "google_access_denied"],
    ["unavailable private-key", 500, "upstream_unavailable"],
  ])("sanitizes invalid/error Google responses", async (body, status, code) => {
    const client = createYoutubeClient({ apiKey: "private-key", fetch: mockFetch(String(body), Number(status)) });
    const error = await client.resolve(parseChannelInput("@creator")).catch((error: unknown) => error);
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("private-key");
  });
  it("sanitizes fetch failures and timeouts instead of leaking key-bearing URLs", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("https://google.test/?key=private-key"); });
    const client = createYoutubeClient({ apiKey: "private-key", fetch: fetcher });
    await expect(client.resolve(parseChannelInput("@creator"))).rejects.toThrow("YouTube request failed");
    fetcher.mockRejectedValueOnce(new DOMException("private-key", "TimeoutError"));
    await expect(client.resolve(parseChannelInput("@creator"))).rejects.toMatchObject({ code: "upstream_timeout" });
  });
  it("rejects redirects, missing feeds and declared or streamed oversized responses", async () => {
    const missing = createYoutubeClient({ fetch: mockFetch("not found", 404) });
    await expect(missing.feed(CHANNEL_ID)).rejects.toMatchObject({ code: "channel_not_found" });
    const redirected = createYoutubeClient({ fetch: mockFetch("redirect", 302) });
    await expect(redirected.feed(CHANNEL_ID)).rejects.toMatchObject({ code: "upstream_unavailable" });
    for (const headers of [{}, { "content-length": "1048577" }]) {
      const fetcher = vi.fn<typeof fetch>(async () => new Response("x".repeat(1_048_577), { headers }));
      await expect(createYoutubeClient({ fetch: fetcher }).feed(CHANNEL_ID)).rejects.toMatchObject({ code: "response_too_large" });
    }
  });
  it("rejects malformed direct feed IDs without network work", async () => {
    const fetcher = mockFetch("");
    await expect(createYoutubeClient({ fetch: fetcher }).feed("UCbad")).rejects.toMatchObject({ code: "invalid_channel_id" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

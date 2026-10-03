import { describe, expect, it, vi } from "vitest";
import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { createYoutubeApp } from "./youtube.ts";
import type { YoutubeIngestion } from "../youtube/ingestion.ts";
import { YoutubeError, type YoutubeReader } from "../youtube/types.ts";
import { CHANNEL_ID, OTHER_CHANNEL_ID } from "../youtube/fixtures.ts";

const channel = { channelId: CHANNEL_ID, displayName: "Heartful Harry", handle: "@creator",
  canonicalUrl: `https://www.youtube.com/channel/${CHANNEL_ID}`, lastSyncedAt: null };
function setup() {
  const reader: YoutubeReader = {
    channel: vi.fn(async (id) => id === CHANNEL_ID ? channel : null),
    videos: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
  const ingestion: YoutubeIngestion = {
    resolve: vi.fn(async () => ({ channel, videos: [] })),
    syncAll: vi.fn(async () => ({ complete: true, results: [] })),
  };
  const options = { internalToken: "bot-token", jobToken: "job-token", allowedOrigins: ["https://example.com"] };
  const app = createYoutubeApp(reader, ingestion, options);
  const send = (path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init));
  return { reader, ingestion, app, send, options };
}
const post = (token?: string, body?: unknown): RequestInit => ({
  method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("YouTube API contracts", () => {
  it("exposes public source-only reads and validates bounded parameters", async () => {
    const { reader, send } = setup();
    const result = await send(`/v1/youtube/channels/${CHANNEL_ID}`);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(channel);
    expect((await send(`/v1/youtube/channels/${OTHER_CHANNEL_ID}`)).status).toBe(404);
    expect((await send(`/v1/youtube/channels/${CHANNEL_ID}/videos?limit=15`)).status).toBe(200);
    expect(reader.videos).toHaveBeenCalledWith(CHANNEL_ID, 15, undefined);
    expect((await send(`/v1/youtube/channels/${CHANNEL_ID}/videos`)).status).toBe(200);
    expect(reader.videos).toHaveBeenCalledWith(CHANNEL_ID, 10, undefined);
    expect((await send("/v1/youtube/channels/UCbad")).status).toBe(422);
    expect((await send(`/v1/youtube/channels/${CHANNEL_ID}/videos?limit=51`)).status).toBe(422);
  });
  it("keeps resolution and jobs behind separate service tokens", async () => {
    const { ingestion, send } = setup();
    const resolvePath = "/internal/youtube/channels/resolve";
    expect((await send(resolvePath, post(undefined, { channelUrl: "@creator" }))).status).toBe(401);
    expect((await send(resolvePath, post("job-token", { channelUrl: "@creator" }))).status).toBe(401);
    expect(ingestion.resolve).not.toHaveBeenCalled();
    expect((await send(resolvePath, post("bot-token", { channelUrl: "@creator" }))).status).toBe(200);
    expect(ingestion.resolve).toHaveBeenCalledWith("@creator");
    const jobPath = "/internal/jobs/youtube-ingestion";
    expect((await send(jobPath, post())).status).toBe(401);
    expect((await send(jobPath, post("bot-token"))).status).toBe(401);
    expect(ingestion.syncAll).not.toHaveBeenCalled();
    expect((await send(jobPath, post("job-token"))).status).toBe(200);
    vi.mocked(ingestion.syncAll).mockResolvedValue({ complete: false, results: [{ channelId: CHANNEL_ID, error: "incomplete_feed" }] });
    const partial = await send(jobPath, post("job-token"));
    expect(partial.status).toBe(503);
    expect(await partial.json()).toMatchObject({ complete: false });
  });
  it("reports typed errors and sanitizes unexpected storage/network details", async () => {
    const { ingestion, reader, send } = setup();
    vi.mocked(ingestion.resolve).mockRejectedValue(new YoutubeError("missing_api_key", "Configure the API key.", 503));
    const result = await send("/internal/youtube/channels/resolve", post("bot-token", { channelUrl: "@creator" }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ code: "missing_api_key", error: "Configure the API key." });
    vi.mocked(reader.videos).mockRejectedValue(new YoutubeError("invalid_cursor", "Invalid cursor.", 400));
    expect((await send(`/v1/youtube/channels/${CHANNEL_ID}/videos?cursor=bad`)).status).toBe(400);
    vi.mocked(reader.channel).mockRejectedValue(Object.assign(new Error("SQL secret=private"), { code: "42P01" }));
    const storage = await send(`/v1/youtube/channels/${CHANNEL_ID}`);
    expect(storage.status).toBe(503);
    expect(await storage.text()).not.toContain("private");
  });
  it("shares the news CORS policy and isolates internal readers from public throttling", async () => {
    const { reader, ingestion, send, options } = setup();
    const path = `/v1/youtube/channels/${CHANNEL_ID}`;
    const origin = { Origin: "https://example.com" };
    expect((await send(path, { headers: origin })).headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect((await send(path, { headers: origin, method: "OPTIONS" })).status).toBe(204);
    expect((await send(path, { headers: { Origin: "https://evil.test" }, method: "OPTIONS" })).status).toBe(403);
    const internal = { ...reader, channel: vi.fn(async () => channel) };
    const limited = createYoutubeApp(reader, ingestion, { ...options, internalReader: internal });
    const call = (token?: string) => limited.handle(new Request(`http://localhost${path}`, token ? { headers: { authorization: `Bearer ${token}` } } : {}));
    const responses = await Promise.all(Array.from({ length: 121 }, () => call()));
    expect(responses.slice(0, 120).every(({ status }) => status === 200)).toBe(true);
    expect(responses[120]!.status).toBe(429);
    expect((await call("bot-token")).status).toBe(200);
    expect(internal.channel).toHaveBeenCalledOnce();
    expect((await call("wrong")).status).toBe(429);
  });
  it("retains route hooks when mounted in the shared API without affecting unrelated routes", async () => {
    const { reader, ingestion, options } = setup();
    const app = new Elysia({ adapter: node() }).get("/health/live", () => ({ status: "ok" }))
      .use(createYoutubeApp(reader, ingestion, options));
    const result = await app.handle(new Request(`http://localhost/v1/youtube/channels/${CHANNEL_ID}`, { headers: { Origin: "https://example.com" } }));
    expect(result.status).toBe(200);
    expect(result.headers.get("access-control-allow-origin")).toBe("https://example.com");
    expect((await app.handle(new Request("http://localhost/internal/jobs/youtube-ingestion", post()))).status).toBe(401);
    expect((await app.handle(new Request("http://localhost/health/live"))).status).toBe(200);
  });
});

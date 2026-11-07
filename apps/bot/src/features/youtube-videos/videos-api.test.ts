import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createVideosApi } from "./videos-api.ts";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});
async function failingApi(status: number, code?: string) {
  const server = createServer((_request, response) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ code, error: "private credentials must never be forwarded" }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  return createVideosApi(`http://127.0.0.1:${address.port}`, "private-token");
}
async function classifiedApi(isShort: unknown) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        channel: { channelId: `UC${"a".repeat(22)}`, displayName: "Creator" },
        videos: [{ videoId: "video000001", publishedAt: "2026-10-01T00:00:00Z", isShort }],
      }),
    );
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server");
  return createVideosApi(`http://127.0.0.1:${address.port}`, "private-token");
}
describe("YouTube API error reporting", () => {
  it.each([true, false, null])("preserves content classification: %s", async (isShort) => {
    const result = await (await classifiedApi(isShort)).resolve("@creator");
    expect(result.videos[0]!.isShort).toBe(isShort);
  });
  it.each([undefined, "short", 1])(
    "rejects invalid/missing classification: %s",
    async (isShort) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect((await classifiedApi(isShort)).resolve("@creator")).rejects.toThrow(
        "Couldn't find this YouTube channel",
      );
    },
  );
  it.each(["invalid_google_response", "invalid_feed", "private-api-key"])(
    "logs a safe diagnostic for %s without exposing the response body",
    async (code) => {
      const log = vi.spyOn(console, "warn").mockImplementation(() => {});
      const api = await failingApi(502, code);
      await expect(api.resolve("@creator")).rejects.toThrow();
      expect(log).toHaveBeenCalledExactlyOnceWith("[DEBUG-youtube-resolve-response]", {
        status: 502,
        error_code: code === "private-api-key" ? "unknown" : code,
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|credentials|@creator/);
    },
  );
  it("identifies service-token authentication failure without forwarding upstream text", async () => {
    const api = await failingApi(401);
    await expect(api.resolve("https://www.youtube.com/@heartfulharry2185")).rejects.toThrow(
      "Ask an administrator to check the YouTube service",
    );
  });
  it("identifies a rejected RSS feed using only a known safe error code", async () => {
    const api = await failingApi(502, "invalid_feed");
    await expect(api.resolve("@creator")).rejects.toThrow("Check the channel URL or ID");
  });
  it("identifies a missing API-only Google key", async () => {
    const api = await failingApi(503, "missing_api_key");
    await expect(api.resolve("@creator")).rejects.toThrow("Try a direct YouTube channel ID");
  });
  it("does not leak arbitrary API error messages/codes", async () => {
    const api = await failingApi(502, "private-api-key");
    await expect(api.resolve("@creator")).rejects.toThrow(
      "Couldn't find this YouTube channel. Check",
    );
    await expect(api.resolve("@creator")).rejects.not.toThrow("private");
  });
});

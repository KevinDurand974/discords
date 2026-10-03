import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createVideosApi } from "./videos-api.ts";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
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
describe("YouTube API error reporting", () => {
  it("identifies service-token authentication failure without forwarding upstream text", async () => {
    const api = await failingApi(401);
    await expect(api.resolve("https://www.youtube.com/@heartfulharry2185")).rejects.toThrow(
      "NEWS_INTERNAL_TOKEN must match",
    );
  });
  it("identifies a rejected RSS feed using only a known safe error code", async () => {
    const api = await failingApi(502, "invalid_feed");
    await expect(api.resolve("@creator")).rejects.toThrow("invalid RSS feed");
  });
  it("identifies a missing API-only Google key", async () => {
    const api = await failingApi(503, "missing_api_key");
    await expect(api.resolve("@creator")).rejects.toThrow(
      "YOUTUBE_API_KEY is missing from the API",
    );
  });
  it("does not leak arbitrary API error messages/codes", async () => {
    const api = await failingApi(502, "private-api-key");
    await expect(api.resolve("@creator")).rejects.toThrow(
      "YouTube channel could not be resolved. Check",
    );
    await expect(api.resolve("@creator")).rejects.not.toThrow("private");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createBotHealthServer } from "./health.ts";

let server: Server | undefined;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
  server = undefined;
});

describe("bot health", () => {
  it("reports live before Discord connects, then becomes ready", async () => {
    let ready = false;
    server = createBotHealthServer({ isReady: () => ready }, undefined);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/health/live`)).status).toBe(200);
    expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    ready = true;
    const response = await fetch(`${base}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", publications: [] });
    expect((await fetch(`${base}/missing`)).status).toBe(404);
  });

  it("accepts publication jobs only with its shared token", async () => {
    const synchronizeNews = vi.fn(async () => {});
    server = createBotHealthServer({ isReady: () => true }, undefined, {
      token: "jobs-token",
      synchronizeNews,
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const base = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${base}/internal/jobs/news-publication`, { method: "POST" })).status).toBe(
      401,
    );
    expect(
      (
        await fetch(`${base}/internal/jobs/news-publication`, {
          method: "POST",
          headers: { Authorization: "Bearer jobs-token" },
        })
      ).status,
    ).toBe(204);
    expect(synchronizeNews).toHaveBeenCalledOnce();
  });
});

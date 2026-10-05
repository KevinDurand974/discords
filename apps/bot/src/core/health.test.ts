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
  it.each(["success", "failure", "unavailable"])(
    "protects YouTube publication jobs and reports %s",
    async (outcome) => {
      const synchronizeVideos = vi.fn(async () => {
        if (outcome === "failure") throw new Error("Incomplete publication");
      });
      server = createBotHealthServer({ isReady: () => true }, undefined, {
        token: "jobs-token",
        ...(outcome === "unavailable" ? {} : { synchronizeVideos }),
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const url = `http://127.0.0.1:${address.port}/internal/jobs/youtube-publication`;
      expect((await fetch(url, { method: "POST" })).status).toBe(401);
      expect(synchronizeVideos).not.toHaveBeenCalled();
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: "Bearer jobs-token" },
      });
      expect(response.status).toBe(outcome === "success" ? 204 : outcome === "failure" ? 500 : 503);
    },
  );
  it.each(["success", "failure", "unavailable"])(
    "protects ticket closure jobs and reports %s",
    async (outcome) => {
      const deleteDueTickets = vi.fn(async () => {
        if (outcome === "failure") throw new Error("Deletion failed");
      });
      server = createBotHealthServer({ isReady: () => true }, undefined, {
        token: "jobs-token",
        ...(outcome === "unavailable" ? {} : { deleteDueTickets }),
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Expected TCP address");
      const url = `http://127.0.0.1:${address.port}/internal/jobs/ticket-closures`;
      expect((await fetch(url, { method: "POST" })).status).toBe(401);
      expect(
        (await fetch(url, { method: "POST", headers: { Authorization: "Bearer wrong-token" } }))
          .status,
      ).toBe(401);
      expect(deleteDueTickets).not.toHaveBeenCalled();
      expect((await fetch(url)).status).toBe(404);
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: "Bearer jobs-token" },
      });
      expect(response.status).toBe(outcome === "success" ? 204 : outcome === "failure" ? 500 : 503);
    },
  );

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

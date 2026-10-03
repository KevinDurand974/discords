import { describe, expect, it, vi } from "vitest";
import { refreshYoutube, youtubeScheduler } from "./youtube-jobs.ts";

describe("YouTube refresh", () => {
  it("uses one ten-minute scheduler with bounded retries", () => {
    expect(youtubeScheduler).toMatchObject({
      id: "youtube-refresh-every-10-minutes",
      repeat: { pattern: "*/10 * * * *" },
      template: { name: "youtube-refresh", opts: { attempts: 3, removeOnFail: 100 } },
    });
  });
  it("ingests before publishing using the internal token", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ complete: true }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await refreshYoutube("http://api", "http://bot", "token", request);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "http://api/internal/jobs/youtube-ingestion",
      "http://bot/internal/jobs/youtube-publication",
    ]);
    expect(request.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: "Bearer token" } });
  });
  it.each([503, 401])(
    "still publishes stored pending work after ingestion HTTP %s, then fails for retry",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(null, { status }))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));
      await expect(refreshYoutube("http://api", "http://bot", "token", request)).rejects.toThrow(
        "ingestion HTTP",
      );
      expect(request).toHaveBeenCalledTimes(2);
    },
  );
  it("does not hide an incomplete 200 ingestion result", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ complete: false }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(refreshYoutube("http://api", "http://bot", "token", request)).rejects.toThrow(
      "incomplete ingestion",
    );
  });
  it("attempts publication after a transport failure, without leaking credentials", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("secret-token"))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(refreshYoutube("http://api", "http://bot", "token", request)).rejects.toThrow(
      "ingestion unavailable, publication HTTP 500",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});

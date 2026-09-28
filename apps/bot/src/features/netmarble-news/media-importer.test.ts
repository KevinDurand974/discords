import { describe, expect, it, vi } from "vitest";
import { importMedia, safeMediaUrl } from "./media-importer.ts";

const url = "https://forum.netmarble.com/image.png";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const fetcher = (body: Buffer | string, headers: Record<string, string>) =>
  vi.fn(async () => new Response(body, { headers })) as unknown as typeof fetch;

describe("native media import", () => {
  it("accepts only HTTPS Netmarble hosts, without credentials or nonstandard ports", () => {
    expect(safeMediaUrl(url)?.href).toBe(url);
    [
      "http://forum.netmarble.com/a",
      "https://netmarble.com.evil.test/a",
      "https://localhost/a",
      "https://user@forum.netmarble.com/a",
      "https://forum.netmarble.com:8443/a",
      "file:///a",
    ].forEach((value) => expect(safeMediaUrl(value)).toBeNull());
  });

  it("uploads a supported image with a generated filename", async () => {
    const fetchMock = fetcher(png, {
      "content-type": "image/png",
      "content-length": String(png.length),
    });
    const result = await importMedia(url, "preview-1", 100, fetchMock);
    expect(result.attachment?.name).toBe("preview-1.png");
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(url),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("falls back for MIME spoofing, unsupported content, and oversized streams", async () => {
    expect(
      (await importMedia(url, "image", 100, fetcher("bad", { "content-type": "image/png" })))
        .attachment,
    ).toBeUndefined();
    expect(
      (await importMedia(url, "image", 100, fetcher(png, { "content-type": "text/html" })))
        .fallback,
    ).toContain(url);
    expect(
      (await importMedia(url, "image", 8, fetcher(png, { "content-type": "image/png" })))
        .attachment,
    ).toBeUndefined();
    expect(
      (
        await importMedia(
          url,
          "image",
          100,
          fetcher(png, { "content-type": "image/png", "content-length": "1000" }),
        )
      ).attachment,
    ).toBeUndefined();
  });

  it("does not fetch unsafe URLs or fail the article on network errors", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(
      (await importMedia("https://evil.test/image.png", "image", 100, fetchMock)).fallback,
    ).toContain("unsafe");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await importMedia(url, "image", 100, fetchMock)).fallback).toContain(url);
  });
});

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Routes } from "discord.js";
import { exportEmojis, importEmojis } from "./emoji-transfer.ts";

const app = "123456789012345678";
const source = "223456789012345678";
const gold = { id: "323456789012345678", name: "Gold", animated: false };
const dance = { id: "423456789012345678", name: "Dance", animated: true };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4WQAAAAASUVORK5CYII=",
  "base64",
);
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const losslessWebp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");
function webpChunk(type: string, bytes: Buffer) {
  const header = Buffer.alloc(8);
  header.write(type, 0, "ascii");
  header.writeUInt32LE(bytes.length, 4);
  return Buffer.concat([header, bytes, Buffer.alloc(bytes.length % 2)]);
}
function webpContainer(chunks: Buffer[]) {
  const body = Buffer.concat([Buffer.from("WEBP"), ...chunks]);
  const header = Buffer.alloc(8);
  header.write("RIFF");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}
const extendedHeader = Buffer.alloc(10);
extendedHeader[0] = 0x02;
const frameHeader = Buffer.alloc(16);
frameHeader.writeUIntLE(100, 12, 3);
const animatedWebp = webpContainer([
  webpChunk("VP8X", extendedHeader),
  webpChunk("ANIM", Buffer.alloc(6)),
  ...Array.from({ length: 2 }, () =>
    webpChunk("ANMF", Buffer.concat([frameHeader, webp.subarray(12)])),
  ),
]);
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "emoji-transfer-test-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function api(initial = [] as (typeof gold)[]) {
  const emojis = [...initial];
  return {
    get: vi.fn(async (route: string): Promise<unknown> => {
      if (route === Routes.oauth2CurrentApplication()) return { id: app };
      if (route === Routes.applicationEmojis(app)) return { items: emojis };
      throw new Error("Unexpected route");
    }),
    post: vi.fn(async (_route: string, options?: { body?: unknown }): Promise<unknown> => {
      const body = options?.body as { name: string };
      const emoji = {
        id: String(523456789012345678n + BigInt(emojis.length)),
        name: body.name,
        animated: false,
      };
      emojis.push(emoji);
      return emoji;
    }),
  };
}
const download = () =>
  vi.fn<typeof fetch>(async (url) => new Response(String(url).includes(".gif") ? gif : png));
async function archive(
  entries: unknown[] = [
    { name: "Gold", file: "gold.png" },
    { name: "Dance", file: "dance.gif" },
  ],
) {
  const directory = join(root, "archive");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "gold.png"), png);
  await writeFile(join(directory, "dance.gif"), gif);
  await writeFile(
    join(directory, "emojis.json"),
    JSON.stringify({ version: 1, applicationId: source, emojis: entries }),
  );
  return directory;
}

describe("emoji export", () => {
  it("exports sorted names with PNG/GIF bytes and no token in the archive or CDN request", async () => {
    const rest = api([gold, dance]);
    const fetchImage = download();
    const directory = join(root, "export");
    expect(await exportEmojis(rest, app, directory, fetchImage, "png-gif")).toEqual({
      exported: 2,
      directory,
    });
    const manifest = JSON.parse(await readFile(join(directory, "emojis.json"), "utf8"));
    expect(manifest).toEqual({
      version: 1,
      applicationId: app,
      emojis: [
        { name: "Dance", file: `${dance.id}.gif` },
        { name: "Gold", file: `${gold.id}.png` },
      ],
    });
    expect(await readFile(join(directory, `${gold.id}.png`))).toEqual(png);
    expect(await readFile(join(directory, `${dance.id}.gif`))).toEqual(gif);
    expect(fetchImage).toHaveBeenCalledWith(
      `https://cdn.discordapp.com/emojis/${dance.id}.gif?size=128&quality=lossless`,
      {
        signal: expect.any(AbortSignal),
        redirect: "error",
      },
    );
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("exports static and animated WebP by default and reimports the exact bytes", async () => {
    const directory = join(root, "webp-export");
    const fetchImage = vi.fn<typeof fetch>(
      async (url) => new Response(String(url).includes("animated=true") ? animatedWebp : webp),
    );
    await exportEmojis(api([gold, dance]), app, directory, fetchImage);
    expect(fetchImage).toHaveBeenCalledWith(
      `https://cdn.discordapp.com/emojis/${dance.id}.webp?size=128&quality=lossless&animated=true`,
      expect.anything(),
    );
    expect(fetchImage).toHaveBeenCalledWith(
      `https://cdn.discordapp.com/emojis/${gold.id}.webp?size=128&quality=lossless`,
      expect.anything(),
    );
    expect(JSON.parse(await readFile(join(directory, "emojis.json"), "utf8")).emojis).toEqual([
      { name: "Dance", file: `${dance.id}.webp` },
      { name: "Gold", file: `${gold.id}.webp` },
    ]);
    const destination = api();
    expect(await importEmojis(destination, app, directory)).toMatchObject({ created: 2 });
    expect(destination.post).toHaveBeenCalledWith(Routes.applicationEmojis(app), {
      body: { name: "Dance", image: `data:image/webp;base64,${animatedWebp.toString("base64")}` },
    });
    expect(destination.post).toHaveBeenCalledWith(Routes.applicationEmojis(app), {
      body: { name: "Gold", image: `data:image/webp;base64,${webp.toString("base64")}` },
    });
  });
  it("never overwrites an existing export", async () => {
    const directory = await archive();
    await expect(exportEmojis(api([gold]), app, directory, download())).rejects.toThrow();
    expect(await readFile(join(directory, "gold.png"))).toEqual(png);
  });
  it("cleans up an incomplete export after a failed download", async () => {
    const directory = join(root, "export");
    const fetchImage = vi.fn<typeof fetch>(async () => new Response("Not found", { status: 404 }));
    await expect(exportEmojis(api([gold]), app, directory, fetchImage)).rejects.toThrow("HTTP 404");
    await expect(stat(directory)).rejects.toThrow();
  });
  it("rejects oversized or mismatched images and cleans up", async () => {
    const fetchImage = vi.fn<typeof fetch>(async () => new Response(Buffer.alloc(256 * 1024 + 1)));
    await expect(exportEmojis(api([gold]), app, join(root, "big"), fetchImage)).rejects.toThrow(
      "256 KiB",
    );
    const wrongImage = vi.fn<typeof fetch>(async () => new Response("<html>not an emoji</html>"));
    await expect(exportEmojis(api([gold]), app, join(root, "invalid"), wrongImage)).rejects.toThrow(
      "PNG, GIF or WebP",
    );
  });
  it("supports empty applications and rejects token/application mismatches before creating files", async () => {
    expect((await exportEmojis(api(), app, join(root, "empty"), download())).exported).toBe(0);
    await expect(exportEmojis(api(), source, join(root, "wrong"), download())).rejects.toThrow(
      "does not match",
    );
    await expect(stat(join(root, "wrong"))).rejects.toThrow();
  });
});

describe("emoji import", () => {
  it("imports names and images into a different app, skips existing names and can be rerun", async () => {
    const directory = await archive();
    const rest = api([gold]);
    expect(await importEmojis(rest, app, directory)).toEqual({
      created: 1,
      skipped: 1,
      planned: 1,
      dryRun: false,
    });
    expect(rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationEmojis(app), {
      body: { name: "Dance", image: `data:image/gif;base64,${gif.toString("base64")}` },
    });
    expect(await importEmojis(rest, app, directory)).toMatchObject({ created: 0, skipped: 2 });
    expect(rest.post).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["lossy", webp],
    ["lossless", losslessWebp],
    ["animated", animatedWebp],
  ] as const)(
    "imports %s WebP bytes unchanged with the correct MIME type",
    async (_kind, bytes) => {
      const directory = await archive([{ name: "WebPEmoji", file: "emoji.webp" }]);
      await writeFile(join(directory, "emoji.webp"), bytes);
      const rest = api();
      await importEmojis(rest, app, directory);
      expect(rest.post).toHaveBeenCalledExactlyOnceWith(Routes.applicationEmojis(app), {
        body: { name: "WebPEmoji", image: `data:image/webp;base64,${bytes.toString("base64")}` },
      });
    },
  );
  it.each([
    webp.subarray(0, 12),
    webp.subarray(0, -1),
    png,
    webpContainer([webpChunk("VP8L", Buffer.alloc(1))]),
    webpContainer([webpChunk("VP8 ", Buffer.alloc(10))]),
    webpContainer([webpChunk("VP8X", extendedHeader), webpChunk("ANIM", Buffer.alloc(6))]),
    webpContainer([webpChunk("VP8X", extendedHeader), webpChunk("ANMF", Buffer.alloc(24))]),
  ])("rejects malformed or truncated WebP before any upload (%#)", async (bytes) => {
    const directory = await archive([{ name: "WebPEmoji", file: "emoji.webp" }]);
    await writeFile(join(directory, "emoji.webp"), bytes);
    const rest = api();
    await expect(importEmojis(rest, app, directory)).rejects.toThrow("PNG, GIF or WebP");
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("validates and reports dry-run counts without uploading", async () => {
    const rest = api();
    expect(await importEmojis(rest, app, await archive(), true)).toEqual({
      created: 0,
      skipped: 0,
      planned: 2,
      dryRun: true,
    });
    expect(rest.post).not.toHaveBeenCalled();
  });
  it.each([
    "../secret.png",
    "/secret.png",
    "C:\\secret.png",
    "https://example.com/image.png",
    "image.svg",
  ])("rejects unsafe filenames %s without uploading", async (file) => {
    const rest = api();
    await expect(importEmojis(rest, app, await archive([{ name: "Gold", file }]))).rejects.toThrow(
      "filename",
    );
    expect(rest.post).not.toHaveBeenCalled();
  });
  it.each(["", "a", "not valid", "../name", "a".repeat(33)])(
    "rejects invalid emoji names %s",
    async (name) => {
      await expect(
        importEmojis(api(), app, await archive([{ name, file: "gold.png" }])),
      ).rejects.toThrow("name");
    },
  );
  it("validates every image before creating any emoji", async () => {
    const directory = await archive();
    await writeFile(join(directory, "dance.gif"), "not an image");
    const rest = api();
    await expect(importEmojis(rest, app, directory)).rejects.toThrow("PNG, GIF or WebP");
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("rejects missing, oversized, or duplicate images/names before uploading", async () => {
    const directory = await archive();
    const rest = api();
    await rm(join(directory, "gold.png"));
    await expect(importEmojis(rest, app, directory)).rejects.toThrow();
    await writeFile(join(directory, "gold.png"), Buffer.alloc(256 * 1024 + 1));
    await expect(importEmojis(rest, app, directory)).rejects.toThrow("oversized");
    await archive([
      { name: "Gold", file: "gold.png" },
      { name: "Gold", file: "dance.gif" },
    ]);
    await expect(importEmojis(rest, app, directory)).rejects.toThrow("Duplicate");
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("fails safely for a malformed or unknown-version manifest", async () => {
    const directory = await archive();
    await writeFile(join(directory, "emojis.json"), "{bad json");
    await expect(importEmojis(api(), app, directory)).rejects.toThrow();
    await writeFile(
      join(directory, "emojis.json"),
      JSON.stringify({ version: 2, applicationId: source, emojis: [] }),
    );
    await expect(importEmojis(api(), app, directory)).rejects.toThrow("manifest");
  });
  it("rejects mismatched destination credentials without uploading", async () => {
    const rest = api();
    await expect(importEmojis(rest, source, await archive())).rejects.toThrow("does not match");
    expect(rest.post).not.toHaveBeenCalled();
  });
  it.each([
    ["gold.png", png.subarray(0, 8)],
    ["dance.gif", gif.subarray(0, 6)],
  ] as const)(
    "rejects truncated %s before uploading even if its signature is valid",
    async (file, bytes) => {
      const directory = await archive();
      await writeFile(join(directory, file), bytes);
      const rest = api();
      await expect(importEmojis(rest, app, directory)).rejects.toThrow("PNG, GIF or WebP");
      expect(rest.post).not.toHaveBeenCalled();
    },
  );
  it("uploads the validated snapshot even when the source archive changes before API calls", async () => {
    const directory = await archive();
    const rest = api();
    const get = rest.get.getMockImplementation()!;
    rest.get.mockImplementation(async (route) => {
      await writeFile(join(directory, "gold.png"), "changed after validation");
      return get(route);
    });
    await importEmojis(rest, app, directory);
    expect(rest.post).toHaveBeenCalledWith(Routes.applicationEmojis(app), {
      body: { name: "Gold", image: `data:image/png;base64,${png.toString("base64")}` },
    });
  });
  it("rejects imports exceeding the destination's 2000 emoji limit", async () => {
    const rest = api(
      Array.from({ length: 2000 }, (_, index) => ({
        id: String(BigInt(gold.id) + BigInt(index)),
        name: `Emote_${index}`,
        animated: false,
      })),
    );
    await expect(importEmojis(rest, app, await archive())).rejects.toThrow("2000");
    expect(rest.post).not.toHaveBeenCalled();
  });
  it("resumes after a partial API failure without duplicating created names", async () => {
    const rest = api();
    const create = rest.post.getMockImplementation()!;
    rest.post
      .mockImplementationOnce(create)
      .mockRejectedValueOnce(new Error("Discord upload failed"));
    const directory = await archive();
    await expect(importEmojis(rest, app, directory)).rejects.toThrow("Discord upload failed");
    expect(rest.post).toHaveBeenCalledTimes(2);
    expect(await importEmojis(rest, app, directory)).toMatchObject({ created: 1, skipped: 1 });
    expect(rest.post).toHaveBeenCalledTimes(3);
  });
});

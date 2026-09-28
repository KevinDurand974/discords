import { AttachmentBuilder } from "discord.js";

const formats = {
  "image/png": {
    extension: "png",
    matches: (bytes: Buffer) =>
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  "image/jpeg": {
    extension: "jpg",
    matches: (bytes: Buffer) => bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])),
  },
  "image/gif": {
    extension: "gif",
    matches: (bytes: Buffer) => ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)),
  },
  "image/webp": {
    extension: "webp",
    matches: (bytes: Buffer) =>
      bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
  },
} as const;

export function safeMediaUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["netmarble.com", "netmarble.net"].some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      )
    )
      return null;
    return url;
  } catch {
    return null;
  }
}

export type ImportedMedia = { attachment?: AttachmentBuilder; fallback: string };

export async function importMedia(
  source: string,
  name: string,
  maxBytes: number,
  fetcher: typeof fetch = fetch,
): Promise<ImportedMedia> {
  const url = safeMediaUrl(source);
  const fallback = `${name}: ${url && url.toString().length <= 600 ? url.toString() : "unavailable (unsafe or excessively long source URL)"}`;
  if (!url) return { fallback };
  try {
    const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok || !response.body) return { fallback };
    const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
    const format = mime && formats[mime as keyof typeof formats];
    const size = response.headers.get("content-length");
    if (!format || (size !== null && (!/^\d+$/.test(size) || Number(size) > maxBytes))) {
      await response.body.cancel();
      return { fallback };
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      await (async function read(): Promise<void> {
        const { done, value } = await reader.read();
        if (done) return;
        length += value.byteLength;
        if (length > maxBytes) return;
        chunks.push(value);
        await read();
      })();
      if (length > maxBytes || !length) return { fallback };
      const bytes = Buffer.concat(chunks, length);
      if (!format.matches(bytes)) return { fallback };
      return {
        attachment: new AttachmentBuilder(bytes, { name: `${name}.${format.extension}` }),
        fallback,
      };
    } finally {
      await reader.cancel().catch(() => {});
    }
  } catch {
    return { fallback };
  }
}

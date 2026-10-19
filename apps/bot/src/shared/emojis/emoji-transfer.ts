import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Routes, type REST } from "discord.js";

const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_EMOJIS = 2000;
type EmojiEntry = { name: string; file: string };
type EmojiArchive = { version: 1; applicationId: string; emojis: EmojiEntry[] };
type TransferRest = Pick<REST, "get" | "post">;
type RemoteEmoji = { id: string; name: string; animated: boolean };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid emoji archive or Discord response.");
  return value as Record<string, unknown>;
}
function validName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_]{2,32}$/.test(value);
}
function uniqueNames(entries: readonly { name: string }[]) {
  if (new Set(entries.map(({ name }) => name)).size !== entries.length)
    throw new Error("Duplicate emoji names are not supported.");
}
async function listEmojis(rest: TransferRest, applicationId: string): Promise<RemoteEmoji[]> {
  const application = object(await rest.get(Routes.oauth2CurrentApplication()));
  if (application.id !== applicationId)
    throw new Error("Selected application ID does not match the selected bot token.");
  const response = object(await rest.get(Routes.applicationEmojis(applicationId)));
  if (!Array.isArray(response.items) || response.items.length > MAX_EMOJIS)
    throw new Error("Discord returned an invalid emoji list.");
  const entries = response.items.map((value) => {
    const emoji = object(value);
    if (
      typeof emoji.id !== "string" ||
      !/^\d{17,20}$/.test(emoji.id) ||
      !validName(emoji.name) ||
      (emoji.animated !== undefined && typeof emoji.animated !== "boolean")
    )
      throw new Error("Discord returned an invalid emoji.");
    return { id: emoji.id, name: emoji.name, animated: emoji.animated === true };
  });
  uniqueNames(entries);
  return entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
}
function validWebp(bytes: Buffer) {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    return false;
  const types = new Set<string>();
  function chunks(offset: number, end: number): boolean {
    if (offset === end) return true;
    if (offset + 8 > end) return false;
    const type = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const data = offset + 8;
    const next = data + size + (size % 2);
    if (next > end) return false;
    if (
      type === "VP8 " &&
      (size < 10 || !bytes.subarray(data + 3, data + 6).equals(Buffer.from([0x9d, 0x01, 0x2a])))
    )
      return false;
    if (type === "VP8L" && (size < 5 || bytes[data] !== 0x2f)) return false;
    if (type === "VP8X" && size !== 10) return false;
    if (type === "ANIM" && size !== 6) return false;
    if (type === "ANMF" && (size < 24 || !chunks(data + 16, data + size))) return false;
    types.add(type);
    return chunks(next, end);
  }
  if (!chunks(12, bytes.length) || (!types.has("VP8 ") && !types.has("VP8L"))) return false;
  return (
    (!types.has("ANIM") && !types.has("ANMF")) ||
    (types.has("VP8X") && types.has("ANIM") && types.has("ANMF"))
  );
}

function imageMime(bytes: Buffer, file: string) {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error(`Emoji image must be between 1 byte and 256 KiB: ${file}`);
  if (
    file.endsWith(".png") &&
    bytes.length >= 57 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.subarray(12, 16).toString("ascii") === "IHDR" &&
    bytes.readUInt32BE(16) > 0 &&
    bytes.readUInt32BE(20) > 0 &&
    bytes.includes(Buffer.from("IDAT")) &&
    bytes.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  )
    return "image/png";
  if (
    file.endsWith(".gif") &&
    bytes.length >= 26 &&
    ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii")) &&
    bytes.readUInt16LE(6) > 0 &&
    bytes.readUInt16LE(8) > 0 &&
    bytes.includes(0x2c, 13) &&
    bytes.at(-1) === 0x3b
  )
    return "image/gif";
  if (file.endsWith(".webp") && validWebp(bytes)) return "image/webp";
  throw new Error(`Expected a PNG, GIF or WebP image matching its extension: ${file}`);
}

export async function exportEmojis(
  rest: TransferRest,
  applicationId: string,
  directory: string,
  download: typeof fetch = fetch,
  format: "png-gif" | "webp" = "webp",
) {
  const entries = await listEmojis(rest, applicationId);
  const output = resolve(directory);
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output);
  try {
    const emojis = await entries.reduce<Promise<EmojiEntry[]>>(async (pending, emoji) => {
      const result = await pending;
      const file = `${emoji.id}.${format === "webp" ? "webp" : emoji.animated ? "gif" : "png"}`;
      const animation = format === "webp" && emoji.animated ? "&animated=true" : "";
      const response = await download(
        `https://cdn.discordapp.com/emojis/${file}?size=128&quality=lossless${animation}`,
        {
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        },
      );
      if (!response.ok || !response.body)
        throw new Error(`Could not download emoji ${emoji.name} (HTTP ${response.status}).`);
      let size = 0;
      const chunks = await Array.fromAsync(response.body, (chunk) => {
        size += chunk.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error(`Emoji image exceeds 256 KiB: ${emoji.name}`);
        return chunk;
      });
      const bytes = Buffer.concat(chunks);
      imageMime(bytes, file);
      await writeFile(join(output, file), bytes, { flag: "wx" });
      result.push({ name: emoji.name, file });
      return result;
    }, Promise.resolve([]));
    const archive: EmojiArchive = { version: 1, applicationId, emojis };
    await writeFile(join(output, "emojis.json"), `${JSON.stringify(archive, null, 2)}\n`, {
      flag: "wx",
    });
    return { exported: emojis.length, directory: output };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

async function readArchive(directory: string): Promise<EmojiArchive> {
  const bytes = await readArchiveFile(directory, "emojis.json", 1024 * 1024);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid emojis.json manifest: expected JSON.");
  }
  const archive = object(parsed);
  if (
    archive.version !== 1 ||
    typeof archive.applicationId !== "string" ||
    !/^\d{17,20}$/.test(archive.applicationId) ||
    !Array.isArray(archive.emojis) ||
    archive.emojis.length > MAX_EMOJIS
  )
    throw new Error("Invalid emoji archive manifest.");
  const emojis = archive.emojis.map((value): EmojiEntry => {
    const entry = object(value);
    if (
      !validName(entry.name) ||
      typeof entry.file !== "string" ||
      !/^[A-Za-z0-9_-]+\.(png|gif|webp)$/.test(entry.file)
    )
      throw new Error("Invalid emoji name or image filename in manifest.");
    return { name: entry.name, file: entry.file };
  });
  uniqueNames(emojis);
  return { version: 1, applicationId: archive.applicationId, emojis };
}
async function readArchiveFile(directory: string, file: string, maxBytes: number) {
  const path = join(directory, file);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > maxBytes || dirname(await realpath(path)) !== directory)
    throw new Error(`Invalid, oversized or linked emoji archive file: ${file}`);
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== stat.dev ||
      opened.ino !== stat.ino ||
      opened.size > maxBytes
    )
      throw new Error(`Emoji archive file changed while opening: ${file}`);
    const bytes = Buffer.concat(
      await Array.fromAsync(
        handle.createReadStream({
          autoClose: false,
          start: 0,
          end: maxBytes,
        }),
      ),
    );
    if (bytes.length > maxBytes) throw new Error(`Oversized emoji archive file: ${file}`);
    return bytes;
  } finally {
    await handle.close();
  }
}

async function loadImage(directory: string, file: string) {
  const bytes = await readArchiveFile(directory, file, MAX_IMAGE_BYTES);
  imageMime(bytes, file);
  return bytes;
}

export async function importEmojis(
  rest: TransferRest,
  applicationId: string,
  directory: string,
  dryRun = false,
) {
  const input = await realpath(resolve(directory));
  const archive = await readArchive(input);
  const snapshot = await mkdtemp(join(tmpdir(), "discord-emoji-import-"));
  try {
    // Freeze validated bytes on disk so later archive edits cannot change uploaded images.
    await archive.emojis.reduce(async (previous, { file }, index) => {
      await previous;
      await writeFile(join(snapshot, String(index)), await loadImage(input, file), {
        flag: "wx",
        mode: 0o600,
      });
    }, Promise.resolve());
    const existing = new Set((await listEmojis(rest, applicationId)).map(({ name }) => name));
    const pending = archive.emojis
      .map((emoji, index) => ({ ...emoji, index }))
      .filter(({ name }) => !existing.has(name));
    if (existing.size + pending.length > MAX_EMOJIS)
      throw new Error("Import would exceed Discord's 2000 application emoji limit.");
    if (!dryRun) {
      await pending.reduce(async (previous, { name, file, index }) => {
        await previous;
        const bytes = await readFile(join(snapshot, String(index)));
        const mime = imageMime(bytes, file);
        await rest.post(Routes.applicationEmojis(applicationId), {
          body: { name, image: `data:${mime};base64,${bytes.toString("base64")}` },
        });
      }, Promise.resolve());
    }
    return {
      created: dryRun ? 0 : pending.length,
      skipped: archive.emojis.length - pending.length,
      planned: pending.length,
      dryRun,
    };
  } finally {
    await rm(snapshot, { recursive: true, force: true });
  }
}

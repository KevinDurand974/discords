import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@discords/db";
import { inArray } from "@discords/db/orm";
import { commandLogSettings } from "@discords/db/schema";
import { createCommandLogRepository } from "./command-log-repository.ts";
import { importLogChannels } from "./import-log-channels.ts";

const url = process.env.TEST_DATABASE_URL;
const database = url ? createDatabase(url) : undefined;
const second = url ? createDatabase(url) : undefined;
const guildId = BigInt(`0x${randomBytes(8).toString("hex")}`).toString();
const otherGuildId = (BigInt(guildId) + 1n).toString();

afterAll(async () => {
  try {
    await database?.db
      .delete(commandLogSettings)
      .where(inArray(commandLogSettings.guildId, [guildId, otherGuildId]));
  } finally {
    await Promise.all([database?.pool.end(), second?.pool.end()]);
  }
});

describe.skipIf(!database)("PostgreSQL command log settings", () => {
  it("persists settings across connections and upserts per guild", async () => {
    const store = createCommandLogRepository(database!);
    const reader = createCommandLogRepository(second!);
    expect(await reader.getChannel(guildId)).toBeNull();
    await store.setChannel(guildId, "123");
    expect(await reader.getChannel(guildId)).toBe("123");
    await store.setChannel(guildId, "456");
    expect(await reader.getChannel(guildId)).toBe("456");
    expect(await reader.getChannel(otherGuildId)).toBeNull();
  });

  it("imports legacy settings idempotently without replacing database settings", async () => {
    const data = { [guildId]: "789", [otherGuildId]: "987" };
    expect(await importLogChannels(database!, data)).toBe(1);
    expect(await importLogChannels(database!, data)).toBe(0);
    const store = createCommandLogRepository(second!);
    expect(await store.getChannel(guildId)).toBe("456");
    expect(await store.getChannel(otherGuildId)).toBe("987");
  });

  it("clears only the obsolete guild destination without removing a concurrently reconfigured channel", async () => {
    const store = createCommandLogRepository(database!);
    const reader = createCommandLogRepository(second!);
    await store.setChannel(guildId, "old");
    await reader.setChannel(guildId, "new");
    await store.clearChannel(guildId, "old");
    expect(await reader.getChannel(guildId)).toBe("new");
    await store.clearChannel(guildId, "new");
    expect(await reader.getChannel(guildId)).toBeNull();
    expect(await reader.getChannel(otherGuildId)).toBe("987");
    await store.clearChannel(guildId, "new");
    expect(await reader.getChannel(guildId)).toBeNull();
  });
});

it("rejects malformed legacy settings before touching the database", async () => {
  await expect(importLogChannels(database!, [])).rejects.toThrow("must be an object");
  await expect(importLogChannels(database!, { [guildId]: "123", invalid: 42 })).rejects.toThrow(
    "Invalid log channel settings",
  );
  expect(await importLogChannels(database!, {})).toBe(0);
});

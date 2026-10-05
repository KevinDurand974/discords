import { randomBytes } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "@discords/db";
import { createTicketClosureRepository } from "./ticket-closure-repository.ts";

const url = process.env.TEST_DATABASE_URL;
const writer = url ? createTicketClosureRepository(url) : undefined;
const reader = url ? createTicketClosureRepository(url) : undefined;
const database = url ? createDatabase(url) : undefined;
const channelId = BigInt(`0x${randomBytes(8).toString("hex")}`).toString();
const request = {
  channelId,
  guildId: "123456789012345678",
  ownerId: "234567890123456789",
  requestedBy: "345678901234567890",
};

afterAll(async () => {
  try {
    await writer?.complete(channelId);
  } finally {
    await Promise.all([writer?.close(), reader?.close(), database?.pool.end()]);
  }
});

describe.skipIf(!url)("PostgreSQL ticket closures", () => {
  it("persists the first five-minute deadline and requester without postponing on repeat or concurrent calls", async () => {
    const [first, second] = await Promise.all([
      writer!.schedule(request),
      reader!.schedule({ ...request, requestedBy: "456789012345678901" }),
    ]);
    expect(first).toEqual(second);
    expect(first.deleteAt.getTime() - first.createdAt.getTime()).toBe(300_000);
    const repeated = await reader!.schedule({ ...request, requestedBy: "567890123456789012" });
    expect(repeated).toEqual(first);
    expect(await reader!.getDue(channelId)).toBeNull();
    expect((await reader!.due()).map((row) => row.channelId)).not.toContain(channelId);
  });

  it("rejects a different owner rather than reassigning a pending ticket closure", async () => {
    await expect(reader!.schedule({ ...request, ownerId: "456789012345678901" })).rejects.toThrow(
      "closure record changed",
    );
  });

  it("only processes deadlines that have elapsed and survives a new connection", async () => {
    await database!.pool.query(
      "UPDATE ticket_closures SET delete_at = now() - interval '1 second' WHERE channel_id = $1",
      [channelId],
    );
    const reopened = createTicketClosureRepository(url!);
    try {
      expect((await reopened.getDue(channelId))?.channelId).toBe(channelId);
      expect((await reopened.due()).map((row) => row.channelId)).toContain(channelId);
    } finally {
      await reopened.close();
    }
  });

  it("prevents two repositories processing the same ticket at once, then releases the lock", async () => {
    let announce!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const pending = writer!.withLock(channelId, async () => {
      announce();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await started;
    let called = false;
    try {
      await reader!.withLock(channelId, async () => {
        called = true;
      });
    } finally {
      release();
      await pending;
    }
    expect(called).toBe(false);
    await reader!.withLock(channelId, async () => {
      called = true;
    });
    expect(called).toBe(true);
  });

  it("allows concurrent locked actions to query without exhausting the pool", async () => {
    const ready = Promise.withResolvers<void>();
    let acquired = 0;
    await Promise.all(
      [channelId, `${channelId}-other`].map((key) =>
        writer!.withLock(key, async () => {
          acquired += 1;
          if (acquired === 2) ready.resolve();
          await ready.promise;
          expect((await writer!.get(channelId))?.channelId).toBe(channelId);
        }),
      ),
    );
  });

  it("persists cancellation and assigns a fresh generation to a subsequent closure", async () => {
    const before = await reader!.get(channelId);
    await writer!.withLock(channelId, async () => {
      await writer!.complete(channelId);
    });
    expect(await reader!.get(channelId)).toBeNull();
    expect(await reader!.getDue(channelId)).toBeNull();
    const after = await reader!.schedule(request);
    expect(after.closureId).not.toBe(before!.closureId);
    expect(await writer!.get(channelId)).toEqual(after);
    expect(await writer!.getDue(channelId)).toBeNull();
  });

  it("removes only completed records, idempotently", async () => {
    await writer!.complete(channelId);
    await reader!.complete(channelId);
    expect(await reader!.getDue(channelId)).toBeNull();
  });
});

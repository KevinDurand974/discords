import { createDatabase } from "@discords/db";
import { and, asc, eq, lte, sql } from "@discords/db/orm";
import { ticketClosures } from "@discords/db/schema";

export type TicketClosure = typeof ticketClosures.$inferSelect;
export type TicketClosureRequest = Pick<
  TicketClosure,
  "guildId" | "channelId" | "ownerId" | "requestedBy"
>;

export function createTicketClosureRepository(url: string) {
  const database = createDatabase(url, { max: 2 });
  const locks = createDatabase(url, { max: 2 });
  const { db } = database;
  return {
    async schedule(request: TicketClosureRequest): Promise<TicketClosure> {
      const [created] = await db
        .insert(ticketClosures)
        .values({ ...request, deleteAt: sql`now() + interval '5 minutes'` })
        .onConflictDoNothing()
        .returning();
      const existing =
        created ??
        (
          await db
            .select()
            .from(ticketClosures)
            .where(eq(ticketClosures.channelId, request.channelId))
            .limit(1)
        )[0];
      if (
        !existing ||
        existing.guildId !== request.guildId ||
        existing.ownerId !== request.ownerId
      ) {
        throw new Error("Unable to schedule this ticket: its closure record changed. Try again.");
      }
      return existing;
    },
    async due() {
      return db
        .select()
        .from(ticketClosures)
        .where(lte(ticketClosures.deleteAt, sql`now()`))
        .orderBy(asc(ticketClosures.deleteAt))
        .limit(100);
    },
    async get(channelId: string) {
      return (
        (
          await db
            .select()
            .from(ticketClosures)
            .where(eq(ticketClosures.channelId, channelId))
            .limit(1)
        )[0] ?? null
      );
    },
    async getDue(channelId: string) {
      return (
        (
          await db
            .select()
            .from(ticketClosures)
            .where(
              and(
                eq(ticketClosures.channelId, channelId),
                lte(ticketClosures.deleteAt, sql`now()`),
              ),
            )
            .limit(1)
        )[0] ?? null
      );
    },
    async complete(channelId: string) {
      await db.delete(ticketClosures).where(eq(ticketClosures.channelId, channelId));
    },
    async withLock(channelId: string, work: () => Promise<void>) {
      // Keep lock connections separate so concurrent button actions cannot exhaust the query pool.
      const connection = await locks.pool.connect();
      let locked = false;
      try {
        const result = await connection.query<{ locked: boolean }>(
          "SELECT pg_try_advisory_lock(71404, hashtext($1)) AS locked",
          [channelId],
        );
        locked = result.rows[0]?.locked ?? false;
        if (locked) await work();
        return locked;
      } finally {
        try {
          if (locked)
            await connection.query("SELECT pg_advisory_unlock(71404, hashtext($1))", [channelId]);
        } finally {
          connection.release();
        }
      }
    },
    async close() {
      await Promise.all([database.pool.end(), locks.pool.end()]);
    },
  };
}
export type TicketClosureRepository = ReturnType<typeof createTicketClosureRepository>;

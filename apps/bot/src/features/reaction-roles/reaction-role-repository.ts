import { createDatabase } from "@discords/db";
import { asc, eq, gt } from "@discords/db/orm";
import { reactionRoleMessages } from "@discords/db/schema";

export type ReactionRoleMessage = typeof reactionRoleMessages.$inferSelect;
export type ReactionRoleStore = {
  get(messageId: string): Promise<ReactionRoleMessage | null>;
  list(afterMessageId?: string): Promise<ReactionRoleMessage[]>;
  save(message: ReactionRoleMessage): Promise<void>;
  remove(messageId: string): Promise<void>;
};

export function createReactionRoleRepository(
  database: ReturnType<typeof createDatabase>,
): ReactionRoleStore {
  const { db } = database;
  return {
    async get(messageId) {
      const [message] = await db
        .select()
        .from(reactionRoleMessages)
        .where(eq(reactionRoleMessages.messageId, messageId))
        .limit(1);
      return message ?? null;
    },
    async list(afterMessageId) {
      return db
        .select()
        .from(reactionRoleMessages)
        .where(afterMessageId ? gt(reactionRoleMessages.messageId, afterMessageId) : undefined)
        .orderBy(asc(reactionRoleMessages.messageId))
        .limit(100);
    },
    async save(message) {
      await db.insert(reactionRoleMessages).values(message);
    },
    async remove(messageId) {
      await db.delete(reactionRoleMessages).where(eq(reactionRoleMessages.messageId, messageId));
    },
  };
}

let repository: ReactionRoleStore | undefined;
export function getReactionRoleStore() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for reaction roles.");
  return (repository ??= createReactionRoleRepository(createDatabase(process.env.DATABASE_URL)));
}

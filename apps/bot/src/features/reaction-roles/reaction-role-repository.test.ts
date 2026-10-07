import { expect, it, vi } from "vitest";
import type { createDatabase } from "@discords/db";
import { asc, eq, gt } from "@discords/db/orm";
import { reactionRoleMessages } from "@discords/db/schema";
import {
  createReactionRoleRepository,
  type ReactionRoleMessage,
} from "./reaction-role-repository.ts";

it("lists cleanup candidates in bounded, ordered pages using a message cursor", async () => {
  const limit = vi.fn(async () => []);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  const store = createReactionRoleRepository({
    db: { select: () => ({ from }) },
  } as unknown as ReturnType<typeof createDatabase>);
  expect(await store.list()).toEqual([]);
  expect(where).toHaveBeenLastCalledWith(undefined);
  expect(orderBy).toHaveBeenCalledWith(asc(reactionRoleMessages.messageId));
  expect(limit).toHaveBeenCalledWith(100);
  await store.list("123");
  expect(where).toHaveBeenLastCalledWith(gt(reactionRoleMessages.messageId, "123"));
});

it("persists and reloads message-scoped mappings and removes only the requested message", async () => {
  const message: ReactionRoleMessage = {
    messageId: "message",
    guildId: "guild",
    channelId: "channel",
    mappings: [{ emoji: "🎮", key: "🎮", roleId: "role" }],
  };
  const limit = vi.fn(async (): Promise<ReactionRoleMessage[]> => []);
  const selectWhere = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where: selectWhere }));
  const values = vi.fn(async () => {});
  const insert = vi.fn(() => ({ values }));
  const deleteWhere = vi.fn(async () => {});
  const remove = vi.fn(() => ({ where: deleteWhere }));
  const store = createReactionRoleRepository({
    db: { select: () => ({ from }), insert, delete: remove },
  } as unknown as ReturnType<typeof createDatabase>);
  expect(await store.get("message")).toBeNull();
  limit.mockResolvedValueOnce([message]);
  expect(await store.get("message")).toEqual(message);
  expect(from).toHaveBeenCalledWith(reactionRoleMessages);
  expect(selectWhere).toHaveBeenCalledWith(eq(reactionRoleMessages.messageId, "message"));
  expect(limit).toHaveBeenCalledWith(1);
  await store.save(message);
  expect(insert).toHaveBeenCalledWith(reactionRoleMessages);
  expect(values).toHaveBeenCalledWith(message);
  await store.remove("message");
  expect(remove).toHaveBeenCalledWith(reactionRoleMessages);
  expect(deleteWhere).toHaveBeenCalledWith(eq(reactionRoleMessages.messageId, "message"));
  values.mockRejectedValueOnce(new Error("offline"));
  await expect(store.save(message)).rejects.toThrow("offline");
  deleteWhere.mockRejectedValueOnce(new Error("offline"));
  await expect(store.remove("message")).rejects.toThrow("offline");
});

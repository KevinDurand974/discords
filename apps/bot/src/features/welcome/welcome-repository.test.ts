import { expect, it, vi } from "vitest";
import type { createDatabase } from "@discords/db";
import { welcomeSettings } from "@discords/db/schema";
import { eq } from "@discords/db/orm";
import { createWelcomeRepository, type WelcomeSettings } from "./welcome-repository.ts";

it("resets only the selected server and propagates database failures", async () => {
  const where = vi.fn(async () => {});
  const remove = vi.fn(() => ({ where }));
  const store = createWelcomeRepository({
    db: { delete: remove },
  } as unknown as ReturnType<typeof createDatabase>);
  await store.reset("guild");
  expect(remove).toHaveBeenCalledWith(welcomeSettings);
  expect(where).toHaveBeenCalledWith(eq(welcomeSettings.guildId, "guild"));
  await store.reset("other-guild");
  expect(where).toHaveBeenLastCalledWith(eq(welcomeSettings.guildId, "other-guild"));
  where.mockRejectedValueOnce(new Error("offline"));
  await expect(store.reset("guild")).rejects.toThrow("offline");
});

it("reads persisted settings and upserts the destination and both templates per server", async () => {
  const settings: WelcomeSettings = {
    guildId: "guild",
    channelId: "channel",
    arrivalMessage: "Hello {user}",
    departureMessage: "Bye {user}",
  };
  const limit = vi.fn(async (): Promise<WelcomeSettings[]> => []);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const onConflictDoUpdate = vi.fn(async () => {});
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  const store = createWelcomeRepository({
    db: { select: () => ({ from }), insert },
  } as unknown as ReturnType<typeof createDatabase>);
  expect(await store.get("guild")).toBeNull();
  limit.mockResolvedValueOnce([settings]);
  expect(await store.get("guild")).toEqual(settings);
  expect(from).toHaveBeenCalledWith(welcomeSettings);
  await store.save(settings);
  expect(insert).toHaveBeenCalledWith(welcomeSettings);
  expect(values).toHaveBeenCalledWith(settings);
  expect(onConflictDoUpdate).toHaveBeenCalledWith({
    target: welcomeSettings.guildId,
    set: { channelId: "channel", arrivalMessage: "Hello {user}", departureMessage: "Bye {user}" },
  });
  onConflictDoUpdate.mockRejectedValueOnce(new Error("offline"));
  await expect(store.save(settings)).rejects.toThrow("offline");
});

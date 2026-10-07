import { describe, expect, it, vi } from "vitest";
import type { createDatabase } from "@discords/db";
import { botTrapSettings } from "@discords/db/schema";
import { createTrapRepository } from "./trap-repository.ts";

function fixture() {
  const limit = vi.fn(async () => [] as { guildId: string; channelId: string }[]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const returning = vi.fn(async () => [] as { guildId: string; channelId: string }[]);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn((_row: unknown) => ({ onConflictDoNothing }));
  const deleteWhere = vi.fn(async (_predicate: unknown) => {});
  const db = {
    select: vi.fn(() => ({ from })),
    insert: vi.fn((_table: unknown) => ({ values })),
    delete: vi.fn((_table: unknown) => ({ where: deleteWhere })),
  };
  return {
    db,
    limit,
    from,
    values,
    returning,
    onConflictDoNothing,
    deleteWhere,
    store: createTrapRepository({ db } as unknown as ReturnType<typeof createDatabase>),
  };
}

describe("trap repository", () => {
  it("returns persisted destinations and null for unconfigured guilds", async () => {
    const f = fixture();
    expect(await f.store.getChannel("guild")).toBeNull();
    f.limit.mockResolvedValue([{ guildId: "guild", channelId: "trap" }]);
    expect(await f.store.getChannel("guild")).toBe("trap");
    expect(f.from).toHaveBeenCalledWith(botTrapSettings);
  });
  it("activates a new destination without overwriting another active trap", async () => {
    const f = fixture();
    f.returning.mockResolvedValueOnce([{ guildId: "guild", channelId: "trap" }]);
    expect(await f.store.activate("guild", "trap")).toBe(true);
    expect(await f.store.activate("guild", "duplicate")).toBe(false);
    expect(f.values).toHaveBeenCalledWith({ guildId: "guild", channelId: "trap" });
    expect(f.onConflictDoNothing).toHaveBeenCalledTimes(2);
  });
  it("uses a conditional delete when clearing a deleted or incomplete channel", async () => {
    const f = fixture();
    await f.store.clearChannel("guild", "old");
    expect(f.db.delete).toHaveBeenCalledWith(botTrapSettings);
    expect(f.deleteWhere).toHaveBeenCalledOnce();
    expect(f.deleteWhere).toHaveBeenCalledWith(expect.anything());
  });
  it("propagates persistence failures rather than pretending a trap is monitored", async () => {
    const f = fixture();
    f.returning.mockRejectedValue(new Error("database offline"));
    await expect(f.store.activate("guild", "trap")).rejects.toThrow("database offline");
  });
});

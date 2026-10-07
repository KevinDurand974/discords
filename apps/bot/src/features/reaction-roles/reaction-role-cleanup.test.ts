import { describe, expect, it, vi } from "vitest";
import { Collection, Events, type Client } from "discord.js";
import { buildReactionRoleCleanup, registerReactionRoleCleanup } from "./reaction-role-cleanup.ts";
import type { ReactionRoleMessage, ReactionRoleStore } from "./reaction-role-repository.ts";

function fixture() {
  const record: ReactionRoleMessage = {
    messageId: "111",
    guildId: "guild",
    channelId: "channel",
    mappings: [{ emoji: "🎮", key: "🎮", roleId: "role" }],
  };
  const store = {
    list: vi.fn(async (): Promise<ReactionRoleMessage[]> => []),
    get: vi.fn(async () => record),
    save: vi.fn(async () => {}),
    remove: vi.fn(async (_id: string) => {}),
  } satisfies ReactionRoleStore;
  const messages = { fetch: vi.fn(async (_options: unknown) => ({ id: record.messageId })) };
  const channel = {
    guildId: record.guildId,
    isTextBased: () => true,
    isDMBased: () => false,
    messages,
  };
  const client = {
    isReady: vi.fn(() => true),
    channels: { fetch: vi.fn(async (_id: string, _options: unknown) => channel) },
    on: vi.fn(),
    once: vi.fn(),
  };
  const discord = client as unknown as Client;
  return {
    record,
    store,
    messages,
    channel,
    client,
    discord,
    cleanup: buildReactionRoleCleanup(discord, store),
  };
}

describe("reaction role cleanup", () => {
  it("paginates records and force-fetches live messages without modifying roles or records", async () => {
    const f = fixture();
    const next = { ...f.record, messageId: "222" };
    f.store.list.mockResolvedValueOnce([f.record]).mockResolvedValueOnce([next]);
    await f.cleanup.cleanup();
    expect(f.store.list.mock.calls).toEqual([[undefined], ["111"], ["222"]]);
    expect(f.client.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
    expect(f.messages.fetch.mock.calls).toEqual([
      [{ message: "111", force: true }],
      [{ message: "222", force: true }],
    ]);
    expect(f.store.remove).not.toHaveBeenCalled();
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it.each([10008, 10003])(
    "removes only confirmed missing messages/channels (Discord %s)",
    async (code) => {
      const f = fixture();
      f.store.list.mockResolvedValueOnce([f.record]);
      if (code === 10003) f.client.channels.fetch.mockRejectedValueOnce({ code });
      else f.messages.fetch.mockRejectedValueOnce({ code });
      await f.cleanup.cleanup();
      expect(f.store.remove).toHaveBeenCalledExactlyOnceWith(f.record.messageId);
    },
  );
  it.each([50001, 50013, 429, 500, "ECONNRESET"])(
    "retains records on access/rate-limit/network failure %s",
    async (code) => {
      const f = fixture();
      f.store.list.mockResolvedValueOnce([f.record]);
      f.messages.fetch.mockRejectedValueOnce({ code });
      await expect(f.cleanup.cleanup()).rejects.toThrow("unverified records were retained");
      expect(f.store.remove).not.toHaveBeenCalled();
    },
  );
  it("retains records for inaccessible or mismatched channels", async () => {
    const f = fixture();
    f.store.list.mockResolvedValueOnce([f.record]);
    f.channel.guildId = "other";
    await expect(f.cleanup.cleanup()).rejects.toThrow("cleanup incomplete");
    expect(f.messages.fetch).not.toHaveBeenCalled();
    expect(f.store.remove).not.toHaveBeenCalled();
  });
  it("continues checking records after a failure, then reports it for retry", async () => {
    const f = fixture();
    f.store.list.mockResolvedValueOnce([f.record, { ...f.record, messageId: "222" }]);
    f.messages.fetch.mockRejectedValueOnce({ code: 50013 }).mockRejectedValueOnce({ code: 10008 });
    await expect(f.cleanup.cleanup()).rejects.toThrow("cleanup incomplete");
    expect(f.store.remove).toHaveBeenCalledExactlyOnceWith("222");
  });
  it("reports database failures and allows the next run to retry", async () => {
    const f = fixture();
    f.store.list.mockRejectedValueOnce(new Error("database offline"));
    await expect(f.cleanup.cleanup()).rejects.toThrow("database offline");
    f.store.list.mockResolvedValueOnce([f.record]);
    f.messages.fetch.mockRejectedValueOnce({ code: 10008 });
    f.store.remove.mockRejectedValueOnce(new Error("database offline"));
    await expect(f.cleanup.cleanup()).rejects.toThrow("cleanup incomplete");
    f.store.list.mockResolvedValueOnce([f.record]);
    f.messages.fetch.mockRejectedValueOnce({ code: 10008 });
    await f.cleanup.cleanup();
    expect(f.store.remove).toHaveBeenCalledTimes(2);
  });
  it("does not check or delete anything while Discord is unavailable", async () => {
    const f = fixture();
    f.client.isReady.mockReturnValue(false);
    await expect(f.cleanup.cleanup()).rejects.toThrow("Discord is unavailable");
    expect(f.store.list).not.toHaveBeenCalled();
    expect(f.store.remove).not.toHaveBeenCalled();
  });
  it("shares overlapping startup and cron scans", async () => {
    const f = fixture();
    let finish!: (records: ReactionRoleMessage[]) => void;
    f.store.list.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = f.cleanup.cleanup();
    const second = f.cleanup.cleanup();
    expect(second).toBe(first);
    finish([]);
    await first;
    expect(f.store.list).toHaveBeenCalledOnce();
  });
  it("cleans individual/bulk deletions and scans at readiness, containing event failures", async () => {
    const f = fixture();
    registerReactionRoleCleanup(f.discord, f.store);
    const single = f.client.on.mock.calls.find(([event]) => event === Events.MessageDelete)![1];
    const bulk = f.client.on.mock.calls.find(([event]) => event === Events.MessageBulkDelete)![1];
    await single({ id: "111" });
    await bulk(
      new Collection([
        ["222", {}],
        ["333", {}],
      ]),
    );
    expect(f.store.remove.mock.calls).toEqual([["111"], ["222"], ["333"]]);
    expect(f.client.once).toHaveBeenCalledWith(Events.ClientReady, expect.any(Function));
    await f.client.once.mock.calls[0]![1]();
    expect(f.store.list).toHaveBeenCalledOnce();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      f.store.remove.mockRejectedValueOnce(new Error("offline"));
      await single({ id: "444" });
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});

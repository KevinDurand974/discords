import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Collection, Events, type Client } from "discord.js";
import { registerTrapRuntime } from "./trap-runtime.ts";

function fixture() {
  const guild = { id: "guild" };
  const emitter = Object.assign(new EventEmitter(), {
    guilds: { cache: new Collection([["guild", guild]]) },
  });
  const store = {
    getChannel: vi.fn(async (_guildId: string) => null as string | null),
    activate: vi.fn(async () => true),
    clearChannel: vi.fn(async (_guildId: string, _channelId: string) => {}),
    list: vi.fn(async () => [{ guildId: "guild", channelId: "trap" }]),
  };
  const logger = { setChannel: vi.fn(async () => {}), log: vi.fn(async () => {}) };
  registerTrapRuntime(emitter as unknown as Client, store, logger);
  return { emitter, guild, store };
}

afterEach(() => vi.restoreAllMocks());

describe("trap gateway wiring", () => {
  it("registers message, role, deletion, and startup handlers", () => {
    const f = fixture();
    [
      Events.MessageCreate,
      Events.GuildRoleCreate,
      Events.GuildRoleUpdate,
      Events.ChannelDelete,
      Events.ClientReady,
    ].forEach((event) => expect(f.emitter.listenerCount(event)).toBe(1));
  });
  it("loads persisted traps and reconciles them once after a restart", async () => {
    const f = fixture();
    f.emitter.emit(Events.ClientReady, f.emitter);
    await vi.waitFor(() => expect(f.store.getChannel).toHaveBeenCalledWith("guild"));
    f.emitter.emit(Events.ClientReady, f.emitter);
    expect(f.store.list).toHaveBeenCalledOnce();
  });
  it("disarms only the deleted channel, leaving conditional matching to the store", async () => {
    const f = fixture();
    f.emitter.emit(Events.ChannelDelete, { id: "old", guild: f.guild });
    await vi.waitFor(() => expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "old"));
    f.emitter.emit(Events.ChannelDelete, { id: "dm" });
    expect(f.store.clearChannel).toHaveBeenCalledOnce();
  });
  it("handles creation and renaming of Rules ✓", async () => {
    const f = fixture();
    const role = { name: "Rules ✓", guild: f.guild };
    f.emitter.emit(Events.GuildRoleCreate, role);
    f.emitter.emit(Events.GuildRoleUpdate, { name: "Previous" }, role);
    await vi.waitFor(() => expect(f.store.getChannel).toHaveBeenCalledTimes(2));
  });
  it("reports database failures during reconciliation", async () => {
    const f = fixture();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    f.store.list.mockRejectedValue(new Error("offline"));
    f.emitter.emit(Events.ClientReady, f.emitter);
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce());
  });
});

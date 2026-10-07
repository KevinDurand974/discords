import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  DiscordAPIError,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type Message,
} from "discord.js";
import { buildTrapRuntime } from "./trap-runtime.ts";
import { TRAP_REASON } from "./trap-service.ts";

function fixture() {
  const store = {
    getChannel: vi.fn(async () => "trap" as string | null),
    activate: vi.fn(async () => true),
    clearChannel: vi.fn(async () => {}),
    list: vi.fn(async () => []),
  };
  const logger = { log: vi.fn(async () => {}), setChannel: vi.fn(async () => {}) };
  const bot = { id: "bot", permissions: new PermissionsBitField(P.BanMembers) };
  const roles = new Collection([["guild", { id: "guild" }]]);
  const channel = {
    id: "trap",
    type: ChannelType.GuildText,
    permissionOverwrites: { edit: vi.fn(async () => {}) },
  };
  const guild = {
    id: "guild",
    name: "Test Server",
    ownerId: "owner",
    members: { fetch: vi.fn(), fetchMe: vi.fn(async () => bot) },
    channels: { fetch: vi.fn(async () => channel as typeof channel | null) },
    roles: {
      fetch: vi.fn(async () => new Collection([["accepted", { id: "accepted", name: "Rules ✓" }]])),
    },
  };
  const member = {
    id: "user",
    guild,
    permissions: new PermissionsBitField(),
    roles: { cache: roles },
    bannable: true,
    ban: vi.fn(async () => {}),
    fetch: vi.fn(),
  };
  guild.members.fetch.mockResolvedValue(member);
  member.fetch.mockResolvedValue(member);
  const message = {
    guild,
    channelId: "trap",
    channel: { isThread: () => false, parentId: null as string | null },
    author: { id: "user", tag: "User", bot: false, send: vi.fn(async () => {}) },
    delete: vi.fn(async () => {}),
    client: { user: { id: "bot" } },
    webhookId: null as string | null,
    system: false,
  };
  const runtime = buildTrapRuntime(store, logger);
  return {
    store,
    logger,
    bot,
    member,
    message,
    guild,
    channel,
    runtime,
    run: () => runtime.handleMessage(message as unknown as Message),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("trap message monitoring", () => {
  it("DMs the reason, bans a roleless member, deletes the trap message only, and logs it", async () => {
    const f = fixture();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await f.run();
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "user", force: true });
    expect(f.member.fetch).toHaveBeenCalledWith(true);
    expect(f.member.ban).toHaveBeenCalledExactlyOnceWith({
      reason: TRAP_REASON,
      deleteMessageSeconds: 0,
    });
    expect(f.logger.log).toHaveBeenCalledWith({
      guildId: "guild",
      command: "/trap auto-ban (trap)",
      userId: "user",
      userTag: "User",
      status: "success",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(f.message.author.send).toHaveBeenCalledWith({
      content: expect.stringContaining(TRAP_REASON),
      allowedMentions: { parse: [] },
    });
    expect(f.message.author.send.mock.invocationCallOrder[0]).toBeLessThan(
      f.member.ban.mock.invocationCallOrder[0]!,
    );
    expect(f.message.delete).toHaveBeenCalledOnce();
    expect(f.member.ban.mock.invocationCallOrder[0]).toBeLessThan(
      f.message.delete.mock.invocationCallOrder[0]!,
    );
  });
  it.each(["accepted", "normal", "managed"])("exempts any non-everyone role (%s)", async (id) => {
    const f = fixture();
    f.member.roles.cache.set(id, { id });
    await f.run();
    expect(f.member.ban).not.toHaveBeenCalled();
    expect(f.message.delete).not.toHaveBeenCalled();
    expect(f.message.author.send).not.toHaveBeenCalled();
  });
  it.each(["owner", "administrator", "self", "webhook", "system", "other-channel", "disabled"])(
    "ignores %s",
    async (kind) => {
      const f = fixture();
      if (kind === "owner") f.guild.ownerId = "user";
      if (kind === "administrator") f.member.permissions.add(P.Administrator);
      if (kind === "self") f.message.author.id = "bot";
      if (kind === "webhook") f.message.webhookId = "hook";
      if (kind === "system") f.message.system = true;
      if (kind === "other-channel") f.message.channelId = "elsewhere";
      if (kind === "disabled") f.store.getChannel.mockResolvedValue(null);
      await f.run();
      expect(f.member.ban).not.toHaveBeenCalled();
      expect(f.logger.log).not.toHaveBeenCalled();
    },
  );
  it("ignores direct messages", async () => {
    const f = fixture();
    await f.runtime.handleMessage({ ...f.message, guild: null } as unknown as Message);
    expect(f.store.getChannel).not.toHaveBeenCalled();
  });
  it("also monitors existing threads within the trap", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    f.message.channelId = "thread";
    f.message.channel.isThread = () => true;
    f.message.channel.parentId = "trap";
    await f.run();
    expect(f.member.ban).toHaveBeenCalledOnce();
  });
  it("also bans bot accounts if they genuinely have no non-everyone role", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    f.message.author.bot = true;
    await f.run();
    expect(f.member.ban).toHaveBeenCalledOnce();
  });
  it.each(["permission", "hierarchy", "fetch", "ban"])(
    "fails safely on %s failure without an unhandled rejection",
    async (kind) => {
      const f = fixture();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      if (kind === "permission") f.bot.permissions.remove(P.BanMembers);
      if (kind === "hierarchy") f.member.bannable = false;
      if (kind === "fetch") f.guild.members.fetch.mockRejectedValue(new Error("fetch failed"));
      if (kind === "ban") f.member.ban.mockRejectedValue(new Error("ban failed"));
      await f.run();
      expect(error).toHaveBeenCalledOnce();
      expect(f.logger.log).not.toHaveBeenCalled();
      expect(f.message.delete).not.toHaveBeenCalled();
      if (kind !== "ban") expect(f.member.ban).not.toHaveBeenCalled();
    },
  );
  it("does not ban if the trap is disarmed while checking the member", async () => {
    const f = fixture();
    f.store.getChannel.mockResolvedValueOnce("trap").mockResolvedValueOnce(null);
    await f.run();
    expect(f.member.ban).not.toHaveBeenCalled();
  });
  it("does not ban if a role is assigned immediately before banning", async () => {
    const f = fixture();
    f.member.fetch.mockImplementation(async () => {
      f.member.roles.cache.set("accepted", { id: "accepted" });
      return f.member;
    });
    await f.run();
    expect(f.member.ban).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent trap messages for the same account", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    let release!: () => void;
    f.member.ban.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const first = f.run();
    await vi.waitFor(() => expect(f.member.ban).toHaveBeenCalledOnce());
    const extra = { ...f.message, delete: vi.fn(async () => {}) };
    const second = f.runtime.handleMessage(extra as unknown as Message);
    const third = f.run();
    release();
    await Promise.all([first, second, third]);
    expect(f.member.ban).toHaveBeenCalledOnce();
    expect(f.message.author.send).toHaveBeenCalledOnce();
    expect(extra.delete).toHaveBeenCalledOnce();
    expect(f.message.delete).toHaveBeenCalledTimes(2);
  });
  it("does not let an unrelated message suppress a concurrent trap message", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    await Promise.all([
      f.runtime.handleMessage({ ...f.message, channelId: "other" } as unknown as Message),
      f.run(),
    ]);
    expect(f.member.ban).toHaveBeenCalledOnce();
  });
  it("still bans and deletes the message if the DM is blocked", async () => {
    const f = fixture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    f.message.author.send.mockRejectedValue(new Error("Cannot send messages to this user"));
    await f.run();
    expect(f.member.ban).toHaveBeenCalledOnce();
    expect(f.message.delete).toHaveBeenCalledOnce();
  });
  it("does not fail or undo the ban if message deletion fails", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    f.message.delete.mockRejectedValue(new Error("Missing Permissions"));
    await f.run();
    expect(f.member.ban).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[Trap bot] Failed to delete banned account's trap message",
      expect.any(Error),
    );
  });
  it("silently accepts a trap message that was already deleted", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    f.message.delete.mockRejectedValue(
      new DiscordAPIError(
        { message: "Unknown Message", code: 10008 },
        10008,
        404,
        "DELETE",
        "https://discord.com/api",
        {},
      ),
    );
    await f.run();
    expect(f.member.ban).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });
  it("does not ban or delete if the trap is disabled during the DM", async () => {
    const f = fixture();
    f.message.author.send.mockImplementation(async () => {
      f.store.getChannel.mockResolvedValue(null);
    });
    await f.run();
    expect(f.member.ban).not.toHaveBeenCalled();
    expect(f.message.delete).not.toHaveBeenCalled();
  });
  it("keeps a successful ban even if the optional log destination fails", async () => {
    const f = fixture();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.logger.log.mockRejectedValue(new Error("no logging permission"));
    await f.run();
    expect(f.member.ban).toHaveBeenCalledOnce();
  });
});

describe("trap role and channel reconciliation", () => {
  it("updates existing traps to allow deletion of banned members' messages", async () => {
    const f = fixture();
    await f.runtime.reconcileGuild(
      f.guild as unknown as Parameters<typeof f.runtime.reconcileGuild>[0],
    );
    expect(f.channel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "bot",
      { ManageMessages: true },
      expect.anything(),
    );
  });
  it("hides the trap when Rules ✓ is created or renamed", async () => {
    const f = fixture();
    await f.runtime.handleRulesRole({ name: "Rules ✓", guild: f.guild } as unknown as Parameters<
      typeof f.runtime.handleRulesRole
    >[0]);
    expect(f.channel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "accepted",
      { ViewChannel: false },
      expect.anything(),
    );
  });
  it("ignores unrelated role changes", async () => {
    const f = fixture();
    await f.runtime.handleRulesRole({ name: "Other", guild: f.guild } as unknown as Parameters<
      typeof f.runtime.handleRulesRole
    >[0]);
    expect(f.store.getChannel).not.toHaveBeenCalled();
  });
  it("clears a deleted trap without affecting a replacement", async () => {
    const f = fixture();
    f.guild.channels.fetch.mockResolvedValue(null);
    await f.runtime.reconcileGuild(
      f.guild as unknown as Parameters<typeof f.runtime.reconcileGuild>[0],
    );
    expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "trap");
  });
});

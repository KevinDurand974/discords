import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DiscordAPIError,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { getTrapStore } from "./trap-repository.ts";
import { untrapCommand } from "./untrap.command.ts";

vi.mock("./trap-repository.ts", () => ({ getTrapStore: vi.fn() }));
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  const member = { permissions: new PermissionsBitField([P.ManageChannels, P.BanMembers]) };
  const bot = { id: "bot" };
  const channel = {
    guildId: "guild",
    permissionsFor: vi.fn(() => new PermissionsBitField(P.ManageChannels)),
    delete: vi.fn(async () => {}),
  };
  const guild = {
    id: "guild",
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
    channels: { fetch: vi.fn(async () => channel as typeof channel | null) },
  };
  const store = {
    getChannel: vi.fn(async () => "saved-trap" as string | null),
    clearChannel: vi.fn(async () => {}),
    activate: vi.fn(async () => true),
    list: vi.fn(async () => []),
  };
  const interaction = {
    inGuild: () => true,
    guild: guild as typeof guild | null,
    user: { id: "moderator" },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
  };
  vi.mocked(getTrapStore).mockReturnValue(store);
  return {
    member,
    bot,
    channel,
    guild,
    store,
    interaction,
    run: () => untrapCommand.execute(interaction as unknown as ChatInputCommandInteraction),
  };
}

function unknownChannel() {
  return new DiscordAPIError(
    { message: "Unknown Channel", code: 10003 },
    10003,
    404,
    "DELETE",
    "https://discord.com/api",
    {},
  );
}

describe("/untrap", () => {
  it("registers a guild-only command with the same permissions as /trap", () => {
    expect(commands).toContain(untrapCommand);
    expect(untrapCommand.data.toJSON()).toMatchObject({
      name: "untrap",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: (P.ManageChannels | P.BanMembers).toString(),
    });
    expect(untrapCommand.data.toJSON().options ?? []).toHaveLength(0);
  });
  it.each([true, false])(
    "deletes successful acknowledgment after 10 seconds (configured=%s)",
    async (configured) => {
      const f = fixture();
      if (!configured) f.store.getChannel.mockResolvedValue(null);
      await f.run();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(f.interaction.deleteReply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
    },
  );
  it("clears only the stored destination, then deletes that channel and confirms privately", async () => {
    const f = fixture();
    await f.run();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "moderator", force: true });
    expect(f.store.getChannel).toHaveBeenCalledWith("guild");
    expect(f.store.clearChannel).toHaveBeenCalledExactlyOnceWith("guild", "saved-trap");
    expect(f.guild.channels.fetch).toHaveBeenCalledWith("saved-trap", { force: true });
    expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
    expect(f.channel.permissionsFor).toHaveBeenCalledWith(f.bot);
    expect(f.channel.delete).toHaveBeenCalledExactlyOnceWith("Bot trap removed by moderator");
    expect(f.store.clearChannel.mock.invocationCallOrder[0]).toBeLessThan(
      f.channel.delete.mock.invocationCallOrder[0]!,
    );
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "Bot trap removed. The trap is now disabled.",
      allowedMentions: { parse: [] },
    });
  });
  it("cleans stale data when the channel is already missing", async () => {
    const f = fixture();
    f.guild.channels.fetch.mockResolvedValue(null);
    await f.run();
    expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "saved-trap");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.guild.members.fetchMe).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledOnce();
  });
  it.each(["fetch", "delete"] as const)(
    "handles Unknown Channel during %s and still clears the DB",
    async (stage) => {
      const f = fixture();
      if (stage === "fetch") f.guild.channels.fetch.mockRejectedValue(unknownChannel());
      else f.channel.delete.mockRejectedValue(unknownChannel());
      await f.run();
      expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "saved-trap");
      expect(f.interaction.editReply).toHaveBeenCalledOnce();
    },
  );
  it("reports an unconfigured server without deleting anything", async () => {
    const f = fixture();
    f.store.getChannel.mockResolvedValue(null);
    await f.run();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "No bot trap is configured for this server.",
      allowedMentions: { parse: [] },
    });
    expect(f.store.clearChannel).not.toHaveBeenCalled();
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
  });
  it.each([P.ManageChannels, P.BanMembers])(
    "rejects callers missing %s even with overridden command permissions",
    async (permission) => {
      const f = fixture();
      f.member.permissions.remove(permission);
      await expect(f.run()).rejects.toThrow("Manage Channels and Ban Members");
      expect(f.store.clearChannel).not.toHaveBeenCalled();
      expect(f.channel.delete).not.toHaveBeenCalled();
    },
  );
  it("allows administrators", async () => {
    const f = fixture();
    f.member.permissions = new PermissionsBitField(P.Administrator);
    await f.run();
    expect(f.channel.delete).toHaveBeenCalledOnce();
  });
  it.each(["dm", "missing-guild"])("rejects %s before changing state", async (kind) => {
    const f = fixture();
    if (kind === "dm") f.interaction.inGuild = () => false;
    else f.interaction.guild = null;
    await expect(f.run()).rejects.toThrow("Use this command in a server");
    expect(f.store.clearChannel).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
  it.each(["permissions", "fetch", "delete", "foreign-channel"])(
    "stays disarmed and reports partial cleanup on %s failure",
    async (kind) => {
      const f = fixture();
      vi.spyOn(console, "error").mockImplementation(() => {});
      if (kind === "permissions")
        f.channel.permissionsFor.mockReturnValue(new PermissionsBitField());
      if (kind === "fetch") f.guild.channels.fetch.mockRejectedValue(new Error("Missing Access"));
      if (kind === "delete") f.channel.delete.mockRejectedValue(new Error("REST unavailable"));
      if (kind === "foreign-channel") f.channel.guildId = "other";
      await expect(f.run()).rejects.toThrow("Bot trap disabled");
      expect(vi.getTimerCount()).toBe(0);
      expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "saved-trap");
      expect(f.interaction.editReply).not.toHaveBeenCalled();
      if (kind !== "delete") expect(f.channel.delete).not.toHaveBeenCalled();
    },
  );
  it("does not delete a channel if DB cleanup fails", async () => {
    const f = fixture();
    f.store.clearChannel.mockRejectedValue(new Error("DB unavailable"));
    await expect(f.run()).rejects.toThrow("DB unavailable");
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

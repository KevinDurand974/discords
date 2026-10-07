import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { trapBotCommand } from "./trap-bot.command.ts";
import { createTrapChannel, hideRulesRoles } from "./trap-service.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function fixture() {
  const member = { permissions: new PermissionsBitField([P.ManageChannels, P.BanMembers]) };
  const bot = {
    id: "bot",
    permissions: new PermissionsBitField([P.ManageChannels, P.BanMembers, P.ManageRoles]),
  };
  const channel = {
    id: "trap",
    send: vi.fn(async (_options: unknown) => {}),
    delete: vi.fn(async () => {}),
    permissionOverwrites: {
      edit: vi.fn(async (_id: string, _options: unknown, _reason: unknown) => {}),
    },
  };
  const roles = new Collection([
    ["guild", { id: "guild", name: "@everyone" }],
    ["accepted", { id: "accepted", name: "Rules ✓" }],
    ["duplicate", { id: "duplicate", name: "Rules ✓" }],
    ["other", { id: "other", name: "Other" }],
  ]);
  const guild = {
    id: "guild",
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
    roles: { fetch: vi.fn(async () => roles) },
    channels: {
      fetch: vi.fn(async () => null as typeof channel | null),
      create: vi.fn(async (_options: unknown) => channel),
    },
  };
  const store = {
    getChannel: vi.fn(async () => null as string | null),
    activate: vi.fn(async (_guildId: string, _channelId: string) => true),
    clearChannel: vi.fn(async (_guildId: string, _channelId: string) => {}),
    list: vi.fn(async () => []),
  };
  const interaction = {
    inGuild: () => true,
    guild,
    user: { id: "user", tag: "Publisher" },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    member,
    bot,
    channel,
    guild,
    store,
    interaction,
    run: () => createTrapChannel(interaction as unknown as ChatInputCommandInteraction, store),
  };
}

describe("trap-bot setup", () => {
  it("registers a server-only command requiring moderation permissions", () => {
    expect(commands).toContain(trapBotCommand);
    expect(trapBotCommand.data.toJSON()).toMatchObject({
      name: "trap",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: (P.ManageChannels | P.BanMembers).toString(),
    });
  });
  it("deletes only the setup acknowledgment after 10 seconds, preserving the trap warning", async () => {
    const f = fixture();
    await f.run();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.channel.send).toHaveBeenCalledOnce();
  });
  it("creates a visible channel, warns before enabling posting, and hides all Rules ✓ roles", async () => {
    const f = fixture();
    await f.run();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "trap",
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: "guild",
            allow: [P.ViewChannel, P.ReadMessageHistory],
            deny: [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads],
          },
          {
            id: "bot",
            allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages],
          },
          { id: "accepted", deny: [P.ViewChannel] },
          { id: "duplicate", deny: [P.ViewChannel] },
        ],
      }),
    );
    const payload = f.channel.send.mock.calls[0]![0] as {
      flags: number;
      components: { toJSON(): unknown }[];
      allowedMentions: unknown;
    };
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload.components[0]!.toJSON()).toMatchObject({
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: expect.stringContaining("Do Not Post") },
        {
          type: ComponentType.TextDisplay,
          content: expect.stringContaining("automatically and immediately BAN"),
        },
      ],
    });
    expect(f.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      f.store.activate.mock.invocationCallOrder[0]!,
    );
    expect(f.store.activate).toHaveBeenCalledWith("guild", "trap");
    expect(f.store.activate.mock.invocationCallOrder[0]).toBeLessThan(
      f.channel.permissionOverwrites.edit.mock.invocationCallOrder[0]!,
    );
    expect(f.channel.permissionOverwrites.edit).toHaveBeenCalledWith(
      "guild",
      { SendMessages: true },
      expect.anything(),
    );
  });
  it.each(["member", "bot"] as const)(
    "checks %s permissions before creating anything",
    async (actor) => {
      const f = fixture();
      f[actor].permissions.remove(P.BanMembers);
      await expect(f.run()).rejects.toThrow("Ban Members");
      expect(f.guild.channels.create).not.toHaveBeenCalled();
    },
  );
  it("creates a trap using the submitted normalized channel name", async () => {
    const f = fixture();
    await createTrapChannel(
      f.interaction as unknown as ChatInputCommandInteraction,
      f.store,
      "Custom Trap",
    );
    expect(f.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "custom-trap" }),
    );
  });
  it.each(["   ", "a".repeat(101)])(
    "rejects invalid channel names without creating anything",
    async (name) => {
      const f = fixture();
      await expect(
        createTrapChannel(f.interaction as unknown as ChatInputCommandInteraction, f.store, name),
      ).rejects.toThrow("Channel name");
      expect(f.guild.channels.create).not.toHaveBeenCalled();
    },
  );
  it("requires Manage Roles for the bot's channel overwrites", async () => {
    const f = fixture();
    f.bot.permissions.remove(P.ManageRoles);
    await expect(f.run()).rejects.toThrow("Manage Roles");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });
  it("rejects DMs", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.run()).rejects.toThrow("server-only");
  });
  it("refuses a second trap while the registered channel exists", async () => {
    const f = fixture();
    f.store.getChannel.mockResolvedValue("existing");
    f.guild.channels.fetch.mockResolvedValue(f.channel);
    await expect(f.run()).rejects.toThrow("already active");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });
  it("clears a deleted destination and allows a replacement", async () => {
    const f = fixture();
    f.store.getChannel.mockResolvedValue("deleted");
    await f.run();
    expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "deleted");
  });
  it.each(["warning", "persistence", "opening", "conflict"])(
    "rolls back an incomplete trap on %s failure",
    async (stage) => {
      const f = fixture();
      if (stage === "warning") f.channel.send.mockRejectedValue(new Error("warning failed"));
      if (stage === "persistence")
        f.store.activate.mockRejectedValue(new Error("persistence failed"));
      if (stage === "opening")
        f.channel.permissionOverwrites.edit.mockRejectedValue(new Error("opening failed"));
      if (stage === "conflict") f.store.activate.mockResolvedValue(false);
      await expect(f.run()).rejects.toThrow();
      expect(f.store.clearChannel).toHaveBeenCalledWith("guild", "trap");
      expect(f.channel.delete).toHaveBeenCalledOnce();
      expect(f.interaction.editReply).not.toHaveBeenCalled();
      if (stage !== "opening") expect(f.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    },
  );
  it("keeps a working trap when only the private confirmation fails", async () => {
    const f = fixture();
    f.interaction.editReply.mockRejectedValue(new Error("expired token"));
    await expect(f.run()).rejects.toThrow("expired token");
    expect(f.store.clearChannel).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
  it("can hide Rules ✓ roles created after the trap", async () => {
    const f = fixture();
    await hideRulesRoles(
      f.guild as unknown as Parameters<typeof hideRulesRoles>[0],
      f.channel as unknown as Parameters<typeof hideRulesRoles>[1],
    );
    expect(f.channel.permissionOverwrites.edit.mock.calls.map(([id]) => id)).toEqual([
      "accepted",
      "duplicate",
    ]);
  });
});

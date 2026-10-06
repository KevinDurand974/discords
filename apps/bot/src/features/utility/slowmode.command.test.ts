import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "../../core/command-registry.ts";
import { slowmodeCommand } from "./slowmode.command.ts";

function fixture(
  duration = 10,
  userPermissions = [P.ManageChannels],
  botPermissions = [P.ManageChannels],
) {
  const member = { id: "user" };
  const bot = { id: "bot" };
  const channel = {
    type: ChannelType.GuildText as ChannelType,
    permissionsFor: vi.fn(
      (target) => new PermissionsBitField(target === member ? userPermissions : botPermissions),
    ),
    setRateLimitPerUser: vi.fn(async () => {}),
  };
  const guild = {
    channels: { fetch: vi.fn(async () => channel as typeof channel | null) },
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
  };
  const interaction = {
    inGuild: () => true,
    guild,
    channelId: "channel",
    user: member,
    options: { getInteger: vi.fn(() => duration) },
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
  return {
    channel,
    guild,
    interaction,
    execute: () => slowmodeCommand.execute(interaction as unknown as ChatInputCommandInteraction),
  };
}

describe("/slowmode", () => {
  it("registers a guild-only command with a required bounded integer duration", () => {
    expect(commands).toContain(slowmodeCommand);
    expect(slowmodeCommand.data.toJSON()).toMatchObject({
      name: "slowmode",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: P.ManageChannels.toString(),
      options: [
        {
          name: "duration",
          type: ApplicationCommandOptionType.Integer,
          required: true,
          min_value: 0,
          max_value: 21600,
        },
      ],
    });
  });

  it.each([1, 10, 21600])(
    "sets slowmode to %i seconds and confirms privately",
    async (duration) => {
      const f = fixture(duration);
      await f.execute();
      expect(f.interaction.options.getInteger).toHaveBeenCalledWith("duration", true);
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.guild.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
      expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "user", force: true });
      expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
      expect(f.channel.setRateLimitPerUser).toHaveBeenCalledExactlyOnceWith(
        duration,
        "Slowmode requested by user",
      );
      expect(f.interaction.editReply).toHaveBeenCalledWith(`Slowmode set to ${duration} seconds.`);
    },
  );

  it("disables slowmode with zero", async () => {
    const f = fixture(0);
    await f.execute();
    expect(f.channel.setRateLimitPerUser).toHaveBeenCalledWith(0, expect.any(String));
    expect(f.interaction.editReply).toHaveBeenCalledWith("Slowmode disabled.");
  });

  it("supports announcement channels and administrator permissions", async () => {
    const f = fixture(60, [P.Administrator], [P.Administrator]);
    f.channel.type = ChannelType.GuildAnnouncement;
    await f.execute();
    expect(f.channel.setRateLimitPerUser).toHaveBeenCalledOnce();
  });

  it.each([-1, 21601, 1.5, NaN])(
    "rejects invalid duration %s without changing the channel",
    async (duration) => {
      const f = fixture(duration);
      await expect(f.execute()).rejects.toThrow("whole number between 0 and 21600");
      expect(f.channel.setRateLimitPerUser).not.toHaveBeenCalled();
    },
  );

  it("rejects DMs", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.execute()).rejects.toThrow("server");
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });

  it.each([ChannelType.GuildVoice, ChannelType.GuildForum, ChannelType.PublicThread])(
    "rejects unsupported channel type %i",
    async (type) => {
      const f = fixture();
      f.channel.type = type;
      await expect(f.execute()).rejects.toThrow("text or announcement channel");
      expect(f.channel.setRateLimitPerUser).not.toHaveBeenCalled();
    },
  );

  it("rejects a missing channel", async () => {
    const f = fixture();
    f.guild.channels.fetch.mockResolvedValueOnce(null);
    await expect(f.execute()).rejects.toThrow("text or announcement channel");
    expect(f.channel.setRateLimitPerUser).not.toHaveBeenCalled();
  });

  it.each([
    { user: [], bot: [P.ManageChannels], error: "You need Manage Channels" },
    { user: [P.ManageChannels], bot: [], error: "The bot needs Manage Channels" },
  ])("checks effective user and bot permissions: $error", async ({ user, bot, error }) => {
    const f = fixture(10, user, bot);
    await expect(f.execute()).rejects.toThrow(error);
    expect(f.channel.setRateLimitPerUser).not.toHaveBeenCalled();
  });

  it("does not confirm success if Discord rejects the update", async () => {
    const f = fixture();
    f.channel.setRateLimitPerUser.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.execute()).rejects.toThrow("Missing Permissions");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

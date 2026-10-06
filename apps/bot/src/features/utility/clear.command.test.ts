import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  ChannelType,
  Collection,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "../../core/command-registry.ts";
import { clearCommand } from "./clear.command.ts";

function fixture(
  count: number | null = null,
  userId: string | null = null,
  duration: string | null = null,
) {
  const member = { id: "moderator" };
  const bot = { id: "bot" };
  const messages = new Collection(
    Array.from({ length: Math.max(count ?? 0, 25) }, (_, index) => [
      String(index),
      {
        id: String(index),
        author: { id: index % 2 ? "other" : "target" },
        createdTimestamp: Date.now(),
      },
    ]),
  );
  const channel = {
    id: "channel",
    guildId: "guild",
    members: { fetch: vi.fn(async (_id: string) => ({ id: "thread-member" })) },
    type: ChannelType.GuildText as ChannelType,
    isThread: () => false,
    archived: false,
    locked: false,
    permissionsFor: vi.fn(
      () => new PermissionsBitField([P.ViewChannel, P.ManageMessages, P.ReadMessageHistory]),
    ),
    messages: {
      fetch: vi.fn(
        async ({ limit }: { limit: number }) =>
          new Collection(messages.first(limit).map((message) => [message.id, message])),
      ),
    },
    bulkDelete: vi.fn(
      async (selected: { id: string }[], _filterOld: boolean) =>
        new Collection(selected.map((message) => [message.id, message])),
    ),
  };
  const guild = {
    id: "guild",
    channels: { fetch: vi.fn(async () => channel as typeof channel | null) },
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
  };
  const interaction = {
    inGuild: () => true,
    guild,
    channelId: "channel",
    user: member,
    options: {
      getInteger: vi.fn(() => count),
      getUser: vi.fn(() => (userId ? { id: userId } : null)),
      getString: vi.fn(() => duration),
      getChannel: vi.fn(() => null as { id: string } | null),
    },
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
  return {
    channel,
    guild,
    messages,
    interaction,
    execute: () => clearCommand.execute(interaction as unknown as ChatInputCommandInteraction),
  };
}

describe("/clear", () => {
  it("registers guild-only moderation with optional count, user, duration and channel", () => {
    expect(commands).toContain(clearCommand);
    expect(clearCommand.data.toJSON()).toMatchObject({
      name: "clear",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: P.ManageMessages.toString(),
      options: [
        { name: "count", type: ApplicationCommandOptionType.Integer, min_value: 1, max_value: 100 },
        { name: "user", type: ApplicationCommandOptionType.User },
        { name: "duration", type: ApplicationCommandOptionType.String },
        {
          name: "channel",
          type: ApplicationCommandOptionType.Channel,
          channel_types: [
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement,
            ChannelType.PublicThread,
            ChannelType.PrivateThread,
            ChannelType.AnnouncementThread,
          ],
        },
      ],
    });
    expect(clearCommand.data.toJSON().options?.every((option) => !option.required)).toBe(true);
  });

  it.each([null, 1, 20, 21, 100])(
    "deletes %s messages with a default of 10 and private confirmation",
    async (count) => {
      const f = fixture(count);
      await f.execute();
      expect(f.interaction.options.getChannel).toHaveBeenCalledWith("channel");
      expect(f.guild.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
      expect(f.channel.messages.fetch).toHaveBeenCalledWith({ limit: count ?? 10 });
      expect(f.channel.bulkDelete).toHaveBeenCalledWith(f.messages.first(count ?? 10), true);
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.interaction.editReply).toHaveBeenCalledWith(
        `Deleted ${count ?? 10} message${count === 1 ? "" : "s"}.`,
      );
    },
  );

  it("deletes up to 100 matching messages when targeting a user", async () => {
    const f = fixture(100, "target");
    f.messages.forEach((message) => {
      message.author.id = "target";
    });
    await f.execute();
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    expect(f.channel.bulkDelete).toHaveBeenCalledWith(f.messages.first(100), true);
    expect(f.interaction.editReply).toHaveBeenCalledWith("Deleted 100 messages.");
  });

  it("clears only the selected channel while combining count, user and duration", async () => {
    const origin = fixture();
    const f = fixture(3, "target", "1h");
    f.channel.id = "selected";
    f.interaction.options.getChannel.mockReturnValue({ id: "selected" });
    f.guild.channels.fetch.mockImplementation(async (id?: string) =>
      id === "selected" ? f.channel : origin.channel,
    );
    f.messages.get("0")!.createdTimestamp = Date.now() - 2 * 60 * 60 * 1000;
    await f.execute();
    expect(f.guild.channels.fetch).toHaveBeenCalledExactlyOnceWith("selected", { force: true });
    expect(f.channel.bulkDelete).toHaveBeenCalledWith(
      f.messages.filter((message) => message.id !== "0" && message.author.id === "target").first(3),
      true,
    );
    expect(origin.channel.bulkDelete).not.toHaveBeenCalled();
    expect(origin.channel.messages.fetch).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith("Deleted 3 messages in <#selected>.");
  });

  it.each(["user", "bot"])(
    "checks %s permissions in the selected channel, not the invocation channel",
    async (actor) => {
      const f = fixture();
      f.interaction.options.getChannel.mockReturnValue({ id: "selected" });
      if (actor === "bot")
        f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField([P.Administrator]));
      f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField([]));
      await expect(f.execute()).rejects.toThrow(actor === "bot" ? "The bot needs" : "You need");
      expect(f.guild.channels.fetch).toHaveBeenCalledWith("selected", { force: true });
      expect(f.channel.messages.fetch).not.toHaveBeenCalled();
      expect(f.channel.bulkDelete).not.toHaveBeenCalled();
    },
  );

  it("rejects a selected channel from another server", async () => {
    const f = fixture();
    f.interaction.options.getChannel.mockReturnValue({ id: "foreign" });
    f.channel.guildId = "other-guild";
    await expect(f.execute()).rejects.toThrow("in this server");
    expect(f.channel.bulkDelete).not.toHaveBeenCalled();
  });

  it.each(["moderator", "bot"])(
    "rejects private threads when %s is not a member",
    async (actor) => {
      const f = fixture();
      f.channel.type = ChannelType.PrivateThread;
      f.channel.isThread = () => true;
      f.channel.members.fetch.mockImplementation(async (id) => {
        if (id === actor) throw new Error("Unknown Member");
        return { id };
      });
      await expect(f.execute()).rejects.toThrow("members of the private thread");
      expect(f.channel.bulkDelete).not.toHaveBeenCalled();
    },
  );

  it("allows thread managers to access private threads without membership", async () => {
    const f = fixture();
    f.channel.type = ChannelType.PrivateThread;
    f.channel.isThread = () => true;
    f.channel.permissionsFor.mockReturnValue(new PermissionsBitField([P.Administrator]));
    await f.execute();
    expect(f.channel.members.fetch).not.toHaveBeenCalled();
    expect(f.channel.bulkDelete).toHaveBeenCalledOnce();
  });

  it("only deletes the target's messages, up to count", async () => {
    const f = fixture(3, "target");
    await f.execute();
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    expect(f.channel.bulkDelete).toHaveBeenCalledWith(
      f.messages.filter((message) => message.author.id === "target").first(3),
      true,
    );
  });

  it.each([null, "target"])("applies duration together with count and user %s", async (user) => {
    const f = fixture(3, user, "1h");
    f.messages.get("0")!.createdTimestamp = Date.now() - 2 * 60 * 60 * 1000;
    await f.execute();
    expect(f.interaction.options.getString).toHaveBeenCalledWith("duration");
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({ limit: user ? 100 : 3 });
    expect(f.channel.bulkDelete).toHaveBeenCalledWith(
      f.messages
        .filter((message) => message.id !== "0" && (!user || message.author.id === user))
        .first(user ? 3 : 2),
      true,
    );
  });

  it("does not delete messages outside the requested duration", async () => {
    const f = fixture(10, null, "1m");
    f.messages.forEach((message) => {
      message.createdTimestamp = Date.now() - 2 * 60 * 1000;
    });
    await f.execute();
    expect(f.channel.bulkDelete).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      "No matching messages within the requested duration were found.",
    );
  });

  it("accepts the 14-day maximum but still skips messages at Discord's age limit", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(2_000_000_000_000);
    try {
      const f = fixture(20, null, "2w");
      f.messages.get("0")!.createdTimestamp = Date.now() - 14 * 24 * 60 * 60 * 1000;
      await f.execute();
      expect(f.channel.bulkDelete).toHaveBeenCalledWith(
        f.messages.filter((message) => message.id !== "0").first(19),
        true,
      );
    } finally {
      now.mockRestore();
    }
  });

  it.each(["", "0m", "15d", "3w", "337h", "20161m", "1.5h", "1s", "garbage"])(
    "rejects invalid duration %s before fetching or deleting messages",
    async (duration) => {
      const f = fixture(10, null, duration);
      await expect(f.execute()).rejects.toThrow("Duration must");
      expect(f.interaction.deferReply).not.toHaveBeenCalled();
      expect(f.channel.messages.fetch).not.toHaveBeenCalled();
      expect(f.channel.bulkDelete).not.toHaveBeenCalled();
    },
  );

  it("skips old messages and reports the actual deletion count", async () => {
    const f = fixture(20, "target");
    f.messages.get("0")!.createdTimestamp = Date.now() - 14 * 24 * 60 * 60 * 1000;
    await f.execute();
    expect(f.channel.bulkDelete.mock.calls[0]?.[0]).toHaveLength(12);
    expect(f.interaction.editReply).toHaveBeenCalledWith("Deleted 12 messages.");
  });

  it("does not delete anything when no messages match", async () => {
    const f = fixture(10, "absent");
    await f.execute();
    expect(f.channel.bulkDelete).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      "No matching messages under 14 days old were found.",
    );
  });

  it.each([0, 101, 1.5, NaN])("rejects invalid count %s", async (count) => {
    const f = fixture(count);
    await expect(f.execute()).rejects.toThrow("whole number between 1 and 100");
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it("rejects DMs", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.execute()).rejects.toThrow("server");
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });

  it.each([
    ChannelType.GuildAnnouncement,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ])("supports channel type %s", async (type) => {
    const f = fixture();
    f.channel.type = type;
    f.channel.isThread = () => type !== ChannelType.GuildAnnouncement;
    await f.execute();
    expect(f.channel.bulkDelete).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and missing channels", async () => {
    const f = fixture();
    f.channel.type = ChannelType.GuildForum;
    await expect(f.execute()).rejects.toThrow("text or announcement channel");
    f.guild.channels.fetch.mockResolvedValueOnce(null);
    await expect(f.execute()).rejects.toThrow("text or announcement channel");
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it.each(["archived", "locked"] as const)("rejects %s threads", async (state) => {
    const f = fixture();
    f.channel.isThread = () => true;
    f.channel[state] = true;
    await expect(f.execute()).rejects.toThrow("archived or locked");
    expect(f.channel.bulkDelete).not.toHaveBeenCalled();
  });

  it.each(["user", "bot"])("checks effective %s permissions", async (target) => {
    const f = fixture();
    if (target === "bot")
      f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField([P.Administrator]));
    f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField([]));
    await expect(f.execute()).rejects.toThrow(target === "bot" ? "The bot needs" : "You need");
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it("propagates Discord failures without confirming success", async () => {
    const f = fixture();
    f.channel.bulkDelete.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.execute()).rejects.toThrow("Missing Permissions");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

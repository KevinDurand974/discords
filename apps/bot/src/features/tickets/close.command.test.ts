import { describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "../../core/command-registry.ts";
import { closeCommand } from "./close.command.ts";
import { ticketOwnerId } from "./ticket-service.ts";
import { scheduleTicketClosure } from "./ticket-runtime.ts";
vi.mock("./ticket-runtime.ts", () => ({
  scheduleTicketClosure: vi.fn(),
  changeTicketClosure: vi.fn(),
}));

const ownerId = "123456789012345678";
const otherId = "234567890123456789";
function role(id: string, permissions: bigint[] = [], managed = false) {
  return { id, managed, permissions: new PermissionsBitField(permissions) };
}
function fixture({
  actorId = ownerId,
  roles = [],
  botPermissions = [P.ManageChannels],
}: { actorId?: string; roles?: ReturnType<typeof role>[]; botPermissions?: bigint[] } = {}) {
  const schedule = vi
    .mocked(scheduleTicketClosure)
    .mockReset()
    .mockImplementation(async (request) => ({
      ...request,
      closureId: "12345678-1234-4234-8234-123456789012",
      deleteAt: new Date("2030-01-01T00:05:00Z"),
      createdAt: new Date("2030-01-01T00:00:00Z"),
    }));
  const member = {
    permissions: new PermissionsBitField(roles.map((item) => item.permissions.bitfield)),
    roles: { cache: new Collection(roles.map((item) => [item.id, item])) },
  };
  const bot = { id: "bot" };
  const channel = {
    id: "channel",
    type: ChannelType.GuildText as ChannelType,
    name: "ticket-a3f9c",
    topic: `Support ticket opened by ${ownerId}`,
    permissionsFor: vi.fn(
      (): PermissionsBitField | null => new PermissionsBitField(botPermissions),
    ),
    send: vi.fn(async (_message: unknown) => {}),
    delete: vi.fn(async () => {}),
  };
  const guild = {
    id: "guild",
    ownerId: "345678901234567890",
    channels: { fetch: vi.fn(async () => channel as typeof channel | null) },
    roles: { fetch: vi.fn(async () => {}) },
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
  };
  const interaction = {
    guild,
    channelId: channel.id,
    user: { id: actorId },
    inGuild: () => true,
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
    reply: vi.fn(),
  };
  return {
    channel,
    guild,
    member,
    bot,
    interaction,
    schedule,
    execute: () => closeCommand.execute(interaction as unknown as ChatInputCommandInteraction),
  };
}

describe("/close-ticket", () => {
  it("registers a server-only command accessible to ticket requesters", () => {
    expect(commands).toContain(closeCommand);
    const data = closeCommand.data.toJSON();
    expect(data.name).toBe("close-ticket");
    expect(data.options ?? []).toEqual([]);
    expect(data.contexts).toEqual([InteractionContextType.Guild]);
    expect(data.default_member_permissions).toBeNull();
  });

  it("schedules the requester's ticket and confirms the persisted deadline without deleting", async () => {
    const f = fixture();
    await f.execute();
    expect(f.interaction.deferReply).toHaveBeenCalledExactlyOnceWith({
      flags: MessageFlags.Ephemeral,
    });
    expect(f.guild.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: ownerId, force: true });
    expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
    expect(f.channel.permissionsFor).toHaveBeenCalledWith(f.bot);
    expect(f.schedule).toHaveBeenCalledExactlyOnceWith(
      {
        guildId: "guild",
        channelId: "channel",
        ownerId,
        requestedBy: ownerId,
      },
      f.guild,
    );
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      }),
    );
    const message = JSON.stringify(f.channel.send.mock.calls[0]);
    expect(message).toContain("<t:1893456300:R>");
    expect(message).toContain("Close now");
    expect(message).toContain("Reopen");
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Ticket closing") }),
    );
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    expect(f.interaction.reply).not.toHaveBeenCalled();
  });

  it.each([
    { actorId: otherId, roles: [role("moderator", [P.ManageMessages])] },
    { actorId: otherId, roles: [role("admin", [P.Administrator])] },
    { actorId: "345678901234567890", roles: [] },
  ])("allows moderators, administrators, and the server owner to schedule: %j", async (options) => {
    const f = fixture(options);
    await f.execute();
    expect(f.schedule).toHaveBeenCalledWith(
      {
        guildId: "guild",
        channelId: "channel",
        ownerId,
        requestedBy: options.actorId,
      },
      f.guild,
    );
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it.each([
    [],
    [role("member")],
    [role("guild", [P.ManageMessages])],
    [role("integration", [P.ManageMessages], true)],
    [role("channel-manager", [P.ManageChannels])],
  ])("rejects other users, even if they can see the ticket", async (...roles) => {
    const f = fixture({ actorId: otherId, roles });
    await expect(f.execute()).rejects.toThrow("Only the ticket requester or a moderator");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.schedule).not.toHaveBeenCalled();
  });

  it("rejects DMs", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.execute()).rejects.toThrow("server");
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it.each([
    { name: "general", topic: `Support ticket opened by ${ownerId}` },
    { name: "ticket-a3f9c", topic: "An ordinary channel" },
    { name: "ticket-a3f9c", topic: "Support ticket opened by not-a-user-id" },
    { name: "ticket-a3f9c", topic: `Support ticket opened by ${ownerId}\nAdditional text` },
    { name: "ticket-a3f9c", topic: `Support ticket opened by ${ownerId}\n` },
    {
      name: "ticket-a3f9c",
      topic: `Support ticket opened by ${ownerId}`,
      type: ChannelType.PublicThread,
    },
    {
      name: "ticket-a3f9c",
      topic: `Support ticket opened by ${ownerId}`,
      type: ChannelType.GuildVoice,
    },
  ])("refuses deletion outside a marked ticket text channel: %j", async (values) => {
    const f = fixture({ actorId: otherId, roles: [role("admin", [P.Administrator])] });
    Object.assign(f.channel, values);
    await expect(f.execute()).rejects.toThrow("inside a ticket text channel");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.guild.members.fetch).not.toHaveBeenCalled();
    expect(f.schedule).not.toHaveBeenCalled();
  });

  it("supports legacy title-based ticket channels", async () => {
    const f = fixture();
    f.channel.name = "ticket-need-help";
    await f.execute();
    expect(f.schedule).toHaveBeenCalledOnce();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("rejects missing or already-deleted channels", async () => {
    const f = fixture();
    f.guild.channels.fetch.mockResolvedValueOnce(null);
    await expect(f.execute()).rejects.toThrow("inside a ticket text channel");
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("requires the bot's effective Manage Channels permission", async () => {
    const f = fixture({ botPermissions: [] });
    await expect(f.execute()).rejects.toThrow("The bot needs Manage Channels");
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("refuses deletion when bot channel permissions cannot be resolved", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValueOnce(null);
    await expect(f.execute()).rejects.toThrow("The bot needs Manage Channels");
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("accepts administrator permission bypass for the bot", async () => {
    const f = fixture({ botPermissions: [P.Administrator] });
    await f.execute();
    expect(f.schedule).toHaveBeenCalledOnce();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("does not delete if current roles cannot be fetched", async () => {
    const f = fixture();
    f.guild.roles.fetch.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(f.execute()).rejects.toThrow("Discord unavailable");
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("does not delete if the invoking member cannot be fetched", async () => {
    const f = fixture();
    f.guild.members.fetch.mockRejectedValueOnce(new Error("Unknown Member"));
    await expect(f.execute()).rejects.toThrow("Unknown Member");
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("reports a scheduled closure without claiming full success if the public notice fails", async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error("Missing permissions"));
    await expect(f.execute()).rejects.toThrow(
      "Ticket closure scheduled, but the notice couldn't be posted",
    );
    expect(f.schedule).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });

  it("does not confirm a closure if persistence fails", async () => {
    const f = fixture();
    f.schedule.mockRejectedValueOnce(new Error("Database unavailable"));
    await expect(f.execute()).rejects.toThrow("Database unavailable");
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("ticket marker", () => {
  it("requires a ticket name prefix, text channel, and complete owner marker", () => {
    expect(
      ticketOwnerId({
        type: ChannelType.GuildText,
        name: "ticket-a3f9c",
        topic: `Support ticket opened by ${ownerId}`,
      }),
    ).toBe(ownerId);
    expect(
      ticketOwnerId({ type: ChannelType.GuildText, name: "ticket-a3f9c", topic: null }),
    ).toBeNull();
    expect(ticketOwnerId({ type: ChannelType.GuildText, name: "ticket-a3f9c" })).toBeNull();
  });
});

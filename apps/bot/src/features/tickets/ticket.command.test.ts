import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ComponentType,
  ContainerBuilder,
  InteractionContextType,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits as P,
  PermissionsBitField,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type GuildChannelCreateOptions,
  type MessageCreateOptions,
  type ModalBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { commands, componentHandlers } from "../../core/command-registry.ts";
import { ticketCommand } from "./ticket.command.ts";
import { ticketComponentHandler } from "./ticket-modal.ts";
import { ticketChannelName, ticketCards, validateTicket } from "./ticket-service.ts";

function textContents(card: ContainerBuilder) {
  return card
    .toJSON()
    .components.filter((component) => component.type === ComponentType.TextDisplay)
    .map((component) => component.content);
}

const requiredBotPermissions = [
  P.ManageChannels,
  P.ViewChannel,
  P.SendMessages,
  P.PinMessages,
  P.ReadMessageHistory,
];
function role(id: string, permissions: bigint[] = [], managed = false) {
  return { id, permissions: new PermissionsBitField(permissions), managed };
}
function fixture({
  title = " Need help ",
  description = " Please investigate this issue. ",
  botPermissions = requiredBotPermissions,
}: { title?: string; description?: string; botPermissions?: bigint[] } = {}) {
  const instructions = { pin: vi.fn(async (_reason: string) => {}) };
  const channel = {
    id: "ticket-channel",
    send: vi.fn(async (_data: MessageCreateOptions) => instructions),
    delete: vi.fn(async () => {}),
  };
  const roles = new Collection([
    ["guild", role("guild", [P.ManageMessages])],
    ["moderator", role("moderator", [P.ManageMessages])],
    ["admin", role("admin", [P.Administrator])],
    ["member", role("member")],
    ["other-bot", role("other-bot", [P.ManageMessages], true)],
  ]);
  const create = vi.fn(async (_options: GuildChannelCreateOptions) => channel);
  const guild = {
    id: "guild",
    members: {
      fetchMe: vi.fn(async () => ({
        id: "bot",
        permissions: new PermissionsBitField(botPermissions),
      })),
    },
    roles: { fetch: vi.fn(async () => roles) },
    channels: { create },
  };
  const interaction = {
    guild,
    user: { id: "requester", tag: "requester" },
    customId: "ticket:create:requester",
    inGuild: () => true,
    isModalSubmit: () => true,
    fields: { getTextInputValue: (id: string) => (id === "title" ? title : description) },
    showModal: vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {}),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    interaction,
    guild,
    channel,
    instructions,
    create,
    execute: () => ticketComponentHandler.execute(interaction as unknown as ModalSubmitInteraction),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("/ticket command and modal", () => {
  it("deletes only the creation confirmation five seconds after it is sent", async () => {
    const f = fixture();
    await f.execute();
    await vi.advanceTimersByTimeAsync(4_999);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.interaction.deleteReply).toHaveBeenCalledExactlyOnceWith();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("ignores confirmation cleanup failures", async () => {
    const f = fixture();
    f.interaction.deleteReply.mockRejectedValueOnce(new Error("Unknown message"));
    await f.execute();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("does not schedule deletion of a failed creation response", async () => {
    const f = fixture({ botPermissions: [] });
    await expect(f.execute()).rejects.toThrow("The bot needs");
    expect(vi.getTimerCount()).toBe(0);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });

  it("registers a server-only, option-free command and its modal handler", () => {
    expect(commands).toContain(ticketCommand);
    expect(componentHandlers).toContain(ticketComponentHandler);
    const data = ticketCommand.data.toJSON();
    expect(data.name).toBe("ticket");
    expect(data.options ?? []).toEqual([]);
    expect(data.contexts).toEqual([InteractionContextType.Guild]);
    expect(data.default_member_permissions).toBeNull();
    expect(ticketComponentHandler.matches("ticket:create:requester")).toBe(true);
    expect(ticketComponentHandler.matches("poll:create:requester")).toBe(false);
  });

  it("opens a modal requiring both title and description without creating a channel", async () => {
    const f = fixture();
    await ticketCommand.execute(f.interaction as unknown as ChatInputCommandInteraction);
    const modal = f.interaction.showModal.mock.calls[0]![0].toJSON();
    expect(modal.custom_id).toBe("ticket:create:requester");
    expect(modal.components).toHaveLength(2);
    expect(modal.components).toEqual([
      expect.objectContaining({
        type: ComponentType.Label,
        label: "Title",
        component: expect.objectContaining({
          custom_id: "title",
          required: true,
          min_length: 1,
          max_length: 100,
          style: TextInputStyle.Short,
        }),
      }),
      expect.objectContaining({
        type: ComponentType.Label,
        label: "Description",
        component: expect.objectContaining({
          custom_id: "description",
          required: true,
          min_length: 1,
          max_length: 4000,
          style: TextInputStyle.Paragraph,
        }),
      }),
    ]);
    expect(f.create).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });

  it("denies DMs when opening the form", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(
      ticketCommand.execute(f.interaction as unknown as ChatInputCommandInteraction),
    ).rejects.toThrow("server");
    expect(f.interaction.showModal).not.toHaveBeenCalled();
  });

  it("denies DMs on submission", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.execute()).rejects.toThrow("server");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("rejects another user's modal", async () => {
    const f = fixture();
    f.interaction.customId = "ticket:create:someone-else";
    await expect(f.execute()).rejects.toThrow("another user");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("ignores non-modal components", async () => {
    const f = fixture();
    f.interaction.isModalSubmit = () => false;
    await f.execute();
    expect(f.create).not.toHaveBeenCalled();
  });

  it.each([
    { title: " " },
    { description: " " },
    { title: "T".repeat(101) },
    { description: "D".repeat(4001) },
  ])("rejects invalid mandatory inputs before creating anything", async (input) => {
    const f = fixture(input);
    await expect(f.execute()).rejects.toThrow("required");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });
});

describe("private ticket creation", () => {
  it("grants access only to the requester, bot, and human moderator/admin roles", async () => {
    const f = fixture();
    await f.execute();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const data = f.create.mock.calls[0]![0];
    expect(data).toMatchObject({
      name: expect.stringMatching(/^ticket-[a-f0-9]{5}$/),
      type: ChannelType.GuildText,
      topic: "Support ticket opened by requester",
    });
    expect(data.permissionOverwrites).toEqual([
      { id: "guild", type: OverwriteType.Role, deny: [P.ViewChannel] },
      {
        id: "bot",
        type: OverwriteType.Member,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.PinMessages],
      },
      {
        id: "requester",
        type: OverwriteType.Member,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
      },
      {
        id: "moderator",
        type: OverwriteType.Role,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
      },
      {
        id: "admin",
        type: OverwriteType.Role,
        allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory],
      },
    ]);
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      "Your private ticket is ready: <#ticket-channel>.",
    );
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("first sends and pins closure instructions, then posts a Components V2 request card", async () => {
    const f = fixture({ title: " @everyone ", description: " <@123> details " });
    await f.execute();
    expect(f.channel.send).toHaveBeenCalledTimes(2);
    const instructions = f.channel.send.mock.calls[0]![0];
    expect(instructions.flags).toBe(MessageFlags.IsComponentsV2);
    expect(instructions.content).toBeUndefined();
    expect(instructions.embeds).toBeUndefined();
    const card = instructions.components![0] as ContainerBuilder;
    expect(card.toJSON()).toMatchObject({
      type: ComponentType.Container,
      components: [
        expect.objectContaining({
          type: ComponentType.TextDisplay,
          content: expect.stringContaining("**/close-ticket**"),
        }),
      ],
    });
    expect(f.instructions.pin).toHaveBeenCalledExactlyOnceWith("Ticket closure instructions");
    expect(f.instructions.pin.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.channel.send.mock.invocationCallOrder[0]!,
    );
    expect(f.instructions.pin.mock.invocationCallOrder[0]).toBeLessThan(
      f.channel.send.mock.invocationCallOrder[1]!,
    );
    const request = f.channel.send.mock.calls[1]![0];
    expect(request.flags).toBe(MessageFlags.IsComponentsV2);
    expect(request.content).toBeUndefined();
    expect(request.embeds).toBeUndefined();
    expect(request.allowedMentions).toEqual({ parse: [] });
    const requestCard = request.components![0] as ContainerBuilder;
    expect(requestCard.toJSON()).toMatchObject({
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: "## @everyone" },
        { type: ComponentType.TextDisplay, content: "<@123> details" },
        { type: ComponentType.Separator, divider: true },
        { type: ComponentType.TextDisplay, content: "-# Opened by <@requester>" },
      ],
    });
    expect(instructions.allowedMentions).toEqual({ parse: [] });
  });

  it("splits maximum-length descriptions across cards within the V2 text limit", async () => {
    const f = fixture({ title: "*".repeat(100), description: "D".repeat(4000) });
    await f.execute();
    const requests = f.channel.send.mock.calls.slice(1).map(([data]) => data);
    expect(requests).toHaveLength(2);
    const texts = requests.map((data) => textContents(data.components![0] as ContainerBuilder));
    expect(texts.map((parts) => parts[1]).join("")).toBe("D".repeat(4000));
    texts.forEach((parts) => {
      expect(parts.join("").length).toBeLessThanOrEqual(4000);
      expect(parts[2]).toBe("-# Opened by <@requester>");
    });
    requests.forEach((data) => {
      expect(data.content).toBeUndefined();
      expect(data.embeds).toBeUndefined();
      expect(data.flags).toBe(MessageFlags.IsComponentsV2);
      expect(data.allowedMentions).toEqual({ parse: [] });
    });
  });

  it("rolls back the channel when pinning fails and does not post the request", async () => {
    const f = fixture();
    f.instructions.pin.mockRejectedValueOnce(new Error("Missing Pin Messages"));
    await expect(f.execute()).rejects.toThrow("Missing Pin Messages");
    expect(f.channel.send).toHaveBeenCalledTimes(1);
    expect(f.channel.delete).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });

  it("rolls back when sending the request card fails", async () => {
    const f = fixture();
    f.channel.send
      .mockResolvedValueOnce(f.instructions)
      .mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(f.execute()).rejects.toThrow("Discord unavailable");
    expect(f.instructions.pin).toHaveBeenCalledOnce();
    expect(f.channel.delete).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });

  it.each(requiredBotPermissions)("checks required bot permission %s", async (missing) => {
    const f = fixture({
      botPermissions: requiredBotPermissions.filter((permission) => permission !== missing),
    });
    await expect(f.execute()).rejects.toThrow("The bot needs");
    expect(f.create).not.toHaveBeenCalled();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });

  it("supports administrator permission bypass", async () => {
    const f = fixture({ botPermissions: [P.Administrator] });
    await f.execute();
    expect(f.create).toHaveBeenCalledOnce();
  });

  it("does not create a channel if fetching moderator roles fails", async () => {
    const f = fixture();
    f.guild.roles.fetch.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(f.execute()).rejects.toThrow("Discord unavailable");
    expect(f.create).not.toHaveBeenCalled();
  });

  it("does not confirm success when Discord cannot create the channel", async () => {
    const f = fixture();
    f.create.mockRejectedValueOnce(new Error("Maximum number of channels reached"));
    await expect(f.execute()).rejects.toThrow("Maximum number of channels");
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });

  it("removes an incomplete private channel when posting the ticket fails", async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.execute()).rejects.toThrow("Missing Permissions");
    expect(f.channel.delete).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });

  it("reports a failed cleanup without claiming the ticket is ready", async () => {
    const f = fixture();
    f.channel.send.mockRejectedValueOnce(new Error("Missing Permissions"));
    f.channel.delete.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.execute()).rejects.toThrow("remove its empty channel");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("ticket details", () => {
  it("escapes the title and keeps emoji pairs intact when splitting request cards", () => {
    const details = { title: "*title*", description: "😀".repeat(2000) };
    const texts = ticketCards(details, "123456789012345678").map(textContents);
    expect(
      texts.every(
        (parts) => parts.join("").length <= 4000 && parts.every((part) => part.isWellFormed()),
      ),
    ).toBe(true);
    expect(texts[0]![0]).toBe("## \\*title\\*");
    expect(texts.map((parts) => parts[1]).join("")).toBe(details.description);
    expect(texts[0]![2]).toBe("-# Opened by <@123456789012345678>");
  });
  it("trims inputs and permits exact maximum lengths", () => {
    expect(validateTicket(" T ", " D ")).toEqual({ title: "T", description: "D" });
    expect(validateTicket("T".repeat(100), "D".repeat(4000)).description).toHaveLength(4000);
  });
  it("generates a random five-character suffix without using the title", () => {
    expect(ticketChannelName()).toMatch(/^ticket-[a-f0-9]{5}$/);
    expect(ticketChannelName()).toHaveLength(12);
  });
});

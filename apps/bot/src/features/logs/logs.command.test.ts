import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  ChannelType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import type { CommandExecutionContext } from "@/core/command.ts";
import { logsCommand, logsComponentHandler, logsHelpDescription } from "./logs.command.ts";

function fixture(channel: { id: string; type: ChannelType } | null = null) {
  const request = {
    inGuild: vi.fn(() => true),
    isModalSubmit: vi.fn(() => true),
    guildId: "guild",
    guild: {
      id: "guild",
      roles: {
        fetch: vi.fn(
          async () =>
            new Map([
              ["guild", { id: "guild", permissions: new PermissionsBitField([P.ManageChannels]) }],
              [
                "manager",
                { id: "manager", permissions: new PermissionsBitField([P.ManageChannels]) },
              ],
              ["member", { id: "member", permissions: new PermissionsBitField() }],
            ]),
        ),
      },
      channels: { create: vi.fn(async () => ({ id: "created" })) },
    },
    memberPermissions: new PermissionsBitField([P.ManageChannels]),
    options: { getChannel: vi.fn(() => channel) },
    fields: { getTextInputValue: vi.fn(() => "  new-logs  ") },
    client: { user: { id: "bot" } },
    user: { id: "user", tag: "tester" },
    reply: vi.fn(),
    showModal: vi.fn(),
  };
  const context: CommandExecutionContext = {
    commandLogger: { setChannel: vi.fn(async () => {}), log: vi.fn(async () => {}) },
  };
  return { request, context };
}

describe("/logs", () => {
  it("registers a guild-only root command with an optional text-channel selector and removes /setup logs", () => {
    expect(commands).toContain(logsCommand);
    expect(componentHandlers).toContain(logsComponentHandler);
    const definition = logsCommand.data.toJSON();
    expect(definition.name).toBe("logs");
    expect(definition.default_member_permissions).toBe(P.ManageChannels.toString());
    expect(definition.contexts).toEqual([InteractionContextType.Guild]);
    expect(definition.options).toMatchObject([
      {
        name: "channel",
        type: ApplicationCommandOptionType.Channel,
        channel_types: [ChannelType.GuildText],
      },
    ]);
    expect(definition.options?.[0]?.required).not.toBe(true);
    expect(commands.some((command) => command.data.name === "setup")).toBe(false);
    expect(logsCommand.helpDescription).toBe(logsHelpDescription);
  });
  it("saves an existing selected channel and confirms privately without opening a modal", async () => {
    const { request, context } = fixture({ id: "selected", type: ChannelType.GuildText });
    await logsCommand.execute(request as unknown as ChatInputCommandInteraction, context);
    expect(request.options.getChannel).toHaveBeenCalledWith("channel");
    expect(context.commandLogger.setChannel).toHaveBeenCalledExactlyOnceWith("guild", "selected");
    expect(request.reply).toHaveBeenCalledWith({
      content: "Command logs will now be sent to <#selected>.",
      flags: MessageFlags.Ephemeral,
    });
    expect(request.showModal).not.toHaveBeenCalled();
    expect(request.guild.channels.create).not.toHaveBeenCalled();
  });
  it("opens the existing creation modal with the default name when channel is omitted", async () => {
    const { request, context } = fixture();
    await logsCommand.execute(request as unknown as ChatInputCommandInteraction, context);
    const modal = request.showModal.mock.calls[0]![0].toJSON();
    expect(modal.custom_id).toBe("setup:logs");
    expect(JSON.stringify(modal)).toContain("bot-command-logs");
    expect(JSON.stringify(modal)).toContain("channel-name");
    expect(context.commandLogger.setChannel).not.toHaveBeenCalled();
    expect(request.guild.channels.create).not.toHaveBeenCalled();
  });
  it("keeps pending old setup modals routable through the new feature handler", () => {
    expect(logsComponentHandler.matches("setup:logs")).toBe(true);
    expect(logsComponentHandler.matches("setup:other")).toBe(false);
  });
  it("creates a private log channel, persists it and records the new /logs path", async () => {
    const { request, context } = fixture();
    await logsComponentHandler.execute(request as unknown as ModalSubmitInteraction, context);
    expect(request.fields.getTextInputValue).toHaveBeenCalledWith("channel-name");
    expect(request.guild.channels.create).toHaveBeenCalledWith({
      name: "new-logs",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: "guild", deny: [P.ViewChannel] },
        { id: "bot", allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.ReadMessageHistory] },
        { id: "manager", allow: [P.ViewChannel] },
      ],
      reason: "Command log channel configured by tester",
    });
    expect(context.commandLogger.setChannel).toHaveBeenCalledWith("guild", "created");
    expect(context.commandLogger.log).toHaveBeenCalledWith({
      guildId: "guild",
      command: "/logs",
      userId: "user",
      userTag: "tester",
      status: "success",
    });
    expect(request.reply).toHaveBeenCalledWith({
      content: "Command logs will now be sent to <#created>.",
      flags: MessageFlags.Ephemeral,
    });
  });
  it.each(["command", "modal"])("requires Manage Channels for the %s path", async (path) => {
    const { request, context } = fixture();
    request.memberPermissions = new PermissionsBitField();
    const execute =
      path === "command"
        ? logsCommand.execute(request as unknown as ChatInputCommandInteraction, context)
        : logsComponentHandler.execute(request as unknown as ModalSubmitInteraction, context);
    await expect(execute).rejects.toThrow("Manage Channels");
    expect(context.commandLogger.setChannel).not.toHaveBeenCalled();
    expect(request.guild.channels.create).not.toHaveBeenCalled();
    expect(request.showModal).not.toHaveBeenCalled();
  });
  it.each(["command", "modal"])("rejects DMs for the %s path", async (path) => {
    const { request, context } = fixture();
    request.inGuild.mockReturnValue(false);
    const execute =
      path === "command"
        ? logsCommand.execute(request as unknown as ChatInputCommandInteraction, context)
        : logsComponentHandler.execute(request as unknown as ModalSubmitInteraction, context);
    await expect(execute).rejects.toThrow("server");
    expect(context.commandLogger.setChannel).not.toHaveBeenCalled();
    expect(request.guild.channels.create).not.toHaveBeenCalled();
  });
  it("rejects an empty submitted name without creating a channel", async () => {
    const { request, context } = fixture();
    request.fields.getTextInputValue.mockReturnValue("  ");
    await expect(
      logsComponentHandler.execute(request as unknown as ModalSubmitInteraction, context),
    ).rejects.toThrow("cannot be empty");
    expect(request.guild.channels.create).not.toHaveBeenCalled();
    expect(context.commandLogger.setChannel).not.toHaveBeenCalled();
  });
  it("does not confirm success when saving the destination fails", async () => {
    const { request, context } = fixture({ id: "selected", type: ChannelType.GuildText });
    vi.mocked(context.commandLogger.setChannel).mockRejectedValueOnce(
      new Error("Database unavailable"),
    );
    await expect(
      logsCommand.execute(request as unknown as ChatInputCommandInteraction, context),
    ).rejects.toThrow("Database unavailable");
    expect(request.reply).not.toHaveBeenCalled();
  });
});

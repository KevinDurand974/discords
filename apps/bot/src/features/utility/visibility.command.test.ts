import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  ChannelFlags,
  ChannelFlagsBitField,
  ChannelType,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { commands, componentHandlers } from "../../core/command-registry.ts";
import { visibilityCommand } from "./visibility.command.ts";
import { createVisibilityModal, visibilityComponentHandler } from "./visibility-modal.ts";
import { visibilityChoices, visibilityChannelTypes, type Visibility } from "./visibility.ts";

function fixture() {
  const member = { id: "user" };
  const bot = { id: "bot" };
  const channel = {
    id: "channel",
    guildId: "guild",
    type: ChannelType.GuildText as ChannelType,
    nsfw: false,
    flags: new ChannelFlagsBitField(),
    permissionsFor: vi.fn(() => new PermissionsBitField([P.ViewChannel, P.ManageChannels])),
    edit: vi.fn(async (_options: { nsfw: boolean; flags: number; reason: string }) => {}),
  };
  const guild = {
    id: "guild",
    channels: {
      fetch: vi.fn(
        async (_id: string, _options: { force: boolean }) => channel as typeof channel | null,
      ),
    },
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
  };
  const command = {
    inGuild: () => true,
    guild,
    channelId: "channel",
    user: member,
    options: { getChannel: vi.fn(() => null as { id: string } | null) },
    showModal: vi.fn(),
  };
  const modal = {
    inGuild: () => true,
    isModalSubmit: () => true,
    guild,
    user: member,
    customId: "visibility:user:guild:channel",
    fields: { getRadioGroup: vi.fn(() => "spoiler") },
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
  return {
    channel,
    guild,
    command,
    modal,
    open: () => visibilityCommand.execute(command as unknown as ChatInputCommandInteraction),
    submit: () => visibilityComponentHandler.execute(modal as unknown as ModalSubmitInteraction),
  };
}

describe("/visibility", () => {
  it("registers a guild-only command and modal handler with only one optional channel option", () => {
    expect(commands).toContain(visibilityCommand);
    expect(componentHandlers).toContain(visibilityComponentHandler);
    expect(visibilityCommand.data.toJSON()).toMatchObject({
      name: "visibility",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: P.ManageChannels.toString(),
      options: [
        {
          name: "channel",
          type: ApplicationCommandOptionType.Channel,
          channel_types: [...visibilityChannelTypes],
        },
      ],
    });
    expect(visibilityCommand.data.toJSON().options).toHaveLength(1);
    expect(visibilityCommand.data.toJSON().options?.[0]?.required).not.toBe(true);
    expect(visibilityComponentHandler.matches("visibility:user:guild:channel")).toBe(true);
    expect(visibilityComponentHandler.matches("poll:create:user")).toBe(false);
  });

  it.each(["default", "spoiler", "age-restricted"] as const)(
    "renders the three radio choices with %s preselected",
    (current) => {
      expect(createVisibilityModal("user", "guild", "channel", current).toJSON()).toMatchObject({
        custom_id: "visibility:user:guild:channel",
        title: "Channel visibility",
        components: [
          { type: ComponentType.TextDisplay, content: expect.stringContaining("<#channel>") },
          {
            type: ComponentType.Label,
            label: "Content Visibility",
            component: {
              type: ComponentType.RadioGroup,
              custom_id: "visibility",
              required: true,
              options: visibilityChoices.map((choice) => ({
                ...choice,
                default: choice.value === current,
              })),
            },
          },
        ],
      });
    },
  );

  it.each([
    { nsfw: false, flags: 0, current: "default" },
    { nsfw: false, flags: ChannelFlags.IsSpoilerChannel, current: "spoiler" },
    { nsfw: true, flags: 0, current: "age-restricted" },
  ] as const)(
    "opens a form with current mode $current without changing the channel",
    async ({ nsfw, flags, current }) => {
      const f = fixture();
      f.channel.nsfw = nsfw;
      f.channel.flags = new ChannelFlagsBitField(flags);
      await f.open();
      expect(f.command.options.getChannel).toHaveBeenCalledWith("channel");
      expect(f.guild.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
      expect(f.command.showModal.mock.calls[0]?.[0].toJSON()).toEqual(
        createVisibilityModal("user", "guild", "channel", current).toJSON(),
      );
      expect(f.channel.edit).not.toHaveBeenCalled();
    },
  );

  it("binds the form to the selected channel, not the invocation channel", async () => {
    const f = fixture();
    f.command.options.getChannel.mockReturnValue({ id: "selected" });
    f.channel.id = "selected";
    await f.open();
    expect(f.guild.channels.fetch).toHaveBeenCalledExactlyOnceWith("selected", { force: true });
    expect(f.command.showModal.mock.calls[0]?.[0].toJSON().custom_id).toBe(
      "visibility:user:guild:selected",
    );
    f.modal.customId = "visibility:user:guild:selected";
    await f.submit();
    expect(f.guild.channels.fetch).toHaveBeenLastCalledWith("selected", { force: true });
    expect(f.modal.editReply).toHaveBeenCalledWith({
      content: "Content visibility for <#selected> set to **Spoiler Channel**.",
      allowedMentions: { parse: [] },
    });
  });

  it.each(visibilityChannelTypes)("supports channel type %i", async (type) => {
    const f = fixture();
    f.channel.type = type;
    await f.open();
    await f.submit();
    expect(f.channel.edit).toHaveBeenCalledOnce();
  });

  it.each([
    ChannelType.GuildCategory,
    ChannelType.GuildStageVoice,
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
  ])("rejects unsupported channel type %i before showing a modal or editing", async (type) => {
    const f = fixture();
    f.channel.type = type;
    await expect(f.open()).rejects.toThrow("text, announcement, forum, media or voice");
    await expect(f.submit()).rejects.toThrow("text, announcement, forum, media or voice");
    expect(f.command.showModal).not.toHaveBeenCalled();
    expect(f.channel.edit).not.toHaveBeenCalled();
  });

  it("rejects DMs on open and submit", async () => {
    const f = fixture();
    f.command.inGuild = () => false;
    f.modal.inGuild = () => false;
    await expect(f.open()).rejects.toThrow("server");
    await expect(f.submit()).rejects.toThrow("server");
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it("rejects missing or foreign destination channels", async () => {
    const f = fixture();
    f.guild.channels.fetch.mockResolvedValueOnce(null);
    await expect(f.open()).rejects.toThrow("in this server");
    f.channel.guildId = "foreign";
    await expect(f.submit()).rejects.toThrow("in this server");
    expect(f.channel.edit).not.toHaveBeenCalled();
  });

  it.each([
    "visibility:other:guild:channel",
    "visibility:user:other:channel",
    "visibility:user:guild:",
    "visibility:user:guild:channel:extra",
  ])("rejects unowned or malformed modal %s", async (customId) => {
    const f = fixture();
    f.modal.customId = customId;
    await expect(f.submit()).rejects.toThrow("another user or server");
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.channel.edit).not.toHaveBeenCalled();
  });

  it("rejects invalid visibility without fetching or editing", async () => {
    const f = fixture();
    f.modal.fields.getRadioGroup.mockReturnValue("public");
    await expect(f.submit()).rejects.toThrow("Select Default");
    expect(f.modal.deferReply).not.toHaveBeenCalled();
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.channel.edit).not.toHaveBeenCalled();
  });

  it.each([
    { actor: "user", permissions: [], error: "You need View Channel" },
    { actor: "user", permissions: [P.ManageChannels], error: "You need View Channel" },
    { actor: "user", permissions: [P.ViewChannel], error: "You need View Channel" },
    { actor: "bot", permissions: [], error: "The bot needs View Channel" },
  ])(
    "checks $actor permissions before opening and again on submission",
    async ({ actor, permissions, error }) => {
      const f = fixture();
      const restrict = () => {
        if (actor === "bot")
          f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField([P.Administrator]));
        f.channel.permissionsFor.mockReturnValueOnce(new PermissionsBitField(permissions));
      };
      restrict();
      await expect(f.open()).rejects.toThrow(error);
      expect(f.command.showModal).not.toHaveBeenCalled();
      await f.open();
      restrict();
      await expect(f.submit()).rejects.toThrow(error);
      expect(f.channel.edit).not.toHaveBeenCalled();
    },
  );

  it("supports administrator permission bypass", async () => {
    const f = fixture();
    f.channel.permissionsFor.mockReturnValue(new PermissionsBitField([P.Administrator]));
    await f.open();
    await f.submit();
    expect(f.channel.edit).toHaveBeenCalledOnce();
  });

  it.each(["default", "spoiler", "age-restricted"] as const)(
    "applies %s atomically while preserving unrelated channel flags",
    async (visibility: Visibility) => {
      const f = fixture();
      await f.open();
      f.channel.nsfw = true;
      f.channel.flags = new ChannelFlagsBitField(
        ChannelFlags.IsSpoilerChannel | ChannelFlags.HideMediaDownloadOptions,
      );
      f.modal.fields.getRadioGroup.mockReturnValue(visibility);
      await f.submit();
      expect(f.modal.fields.getRadioGroup).toHaveBeenCalledWith("visibility", true);
      expect(f.modal.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.guild.channels.fetch).toHaveBeenCalledTimes(2);
      expect(f.guild.members.fetch).toHaveBeenLastCalledWith({ user: "user", force: true });
      expect(f.guild.members.fetchMe).toHaveBeenLastCalledWith({ force: true });
      expect(f.channel.edit).toHaveBeenCalledExactlyOnceWith({
        nsfw: visibility === "age-restricted",
        flags:
          ChannelFlags.HideMediaDownloadOptions |
          (visibility === "spoiler" ? ChannelFlags.IsSpoilerChannel : 0),
        reason: "Channel visibility requested by user",
      });
      expect(f.modal.editReply).toHaveBeenCalledOnce();
    },
  );

  it("does not confirm success if Discord refuses the channel update", async () => {
    const f = fixture();
    f.channel.edit.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.submit()).rejects.toThrow("Missing Permissions");
    expect(f.modal.editReply).not.toHaveBeenCalled();
  });

  it("ignores non-modal component interactions", async () => {
    const f = fixture();
    f.modal.isModalSubmit = () => false;
    await f.submit();
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.channel.edit).not.toHaveBeenCalled();
  });
});

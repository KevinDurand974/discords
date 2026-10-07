import { describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ComponentType,
  GuildFeature,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  TextInputStyle,
  type ContainerBuilder,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import { DEFAULT_RULES } from "./default-rules.ts";
import { createRuleComponents } from "./rule-components.ts";
import { RULE_DELETION_WARNING } from "./rule-warning.ts";
import { createRuleModal, ruleCommand, ruleComponentHandler } from "./rule.command.ts";

function fixture() {
  const member = {
    id: "user",
    permissions: new PermissionsBitField([P.ManageChannels, P.ManageRoles]),
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const bot = {
    id: "bot",
    permissions: new PermissionsBitField([P.ManageChannels, P.ManageRoles]),
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const everyone = {
    id: "guild",
    permissions: new PermissionsBitField([P.ViewChannel, P.SendMessages]),
  };
  const role = {
    id: "role",
    managed: false,
    editable: true,
    permissions: new PermissionsBitField(everyone.permissions.bitfield),
    delete: vi.fn(async () => {}),
  };
  const existingRole = { ...role, id: "existing-role", delete: vi.fn(async () => {}) };
  const channel = {
    id: "channel",
    guildId: "guild",
    type: ChannelType.GuildText as ChannelType,
    permissionsFor: vi.fn(
      (_actor: unknown) =>
        new PermissionsBitField([
          P.ViewChannel,
          P.SendMessages,
          P.ManageMessages,
          P.ReadMessageHistory,
        ]),
    ),
    send: vi.fn(
      async (_options: {
        flags: number;
        components: ContainerBuilder[];
        allowedMentions: { parse: string[] };
      }) => {},
    ),
    messages: { fetch: vi.fn(async () => new Collection()) },
    delete: vi.fn(async () => {}),
  };
  const guild = {
    id: "guild",
    ownerId: "owner",
    roles: {
      fetch: vi.fn(async (id: string) =>
        id === "guild" ? everyone : (existingRole as typeof existingRole | null),
      ),
      create: vi.fn(async () => role),
    },
    fetch: vi.fn(async () => ({ features: [] as GuildFeature[] })),
    edit: vi.fn(async (_options: { rulesChannel: string; reason: string }) => {}),
    channels: {
      fetch: vi.fn(async () => channel as typeof channel | null),
      create: vi.fn(async () => channel),
    },
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
  };
  const values: Record<string, string> = { rules: DEFAULT_RULES, "channel-name": "rules" };
  const interaction = {
    inGuild: () => true,
    isModalSubmit: () => true,
    guild,
    memberPermissions: member.permissions,
    user: { id: "user", tag: "User" },
    customId: "rule:user:guild",
    fields: {
      getTextInputValue: (id: string) => values[id],
      getSelectedChannels: vi.fn(() => new Collection([[channel.id, { id: channel.id }]])),
      getSelectedRoles: vi.fn(() => new Collection<string, { id: string }>()),
    },
    showModal: vi.fn(),
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
  return {
    member,
    bot,
    channel,
    guild,
    interaction,
    values,
    role,
    existingRole,
    everyone,
    open: () => ruleCommand.execute(interaction as unknown as ChatInputCommandInteraction),
    submit: () => ruleComponentHandler.execute(interaction as unknown as ModalSubmitInteraction),
  };
}

describe("/rules", () => {
  it("registers a guild-only command and its handler", () => {
    expect(commands).toContain(ruleCommand);
    expect(componentHandlers).toContain(ruleComponentHandler);
    expect(ruleCommand.data.toJSON()).toMatchObject({
      name: "rules",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: P.ManageChannels.toString(),
    });
    expect(ruleComponentHandler.matches("rule:user:guild")).toBe(true);
    expect(ruleComponentHandler.matches("poll:create:user")).toBe(false);
  });

  it("opens one modal with a channel selector, new channel name and the complete rules template", async () => {
    const f = fixture();
    await f.open();
    const modal = f.interaction.showModal.mock.calls[0]![0].toJSON();
    expect(modal).toEqual(createRuleModal("user", "guild").toJSON());
    expect(modal.components).toHaveLength(5);
    expect(modal.components).toMatchObject([
      {
        type: ComponentType.TextDisplay,
        content: expect.stringContaining("permanently delete ALL"),
      },
      {
        type: ComponentType.Label,
        component: {
          type: ComponentType.ChannelSelect,
          custom_id: "channel",
          required: false,
          channel_types: [ChannelType.GuildText],
          min_values: 0,
          max_values: 1,
        },
      },
      { component: { custom_id: "channel-name", value: "rules", required: false } },
      {
        component: {
          type: ComponentType.RoleSelect,
          custom_id: "acceptance-role",
          required: false,
          min_values: 0,
          max_values: 1,
        },
      },
      {
        component: {
          custom_id: "rules",
          style: TextInputStyle.Paragraph,
          value: DEFAULT_RULES,
          max_length: 4000,
          required: true,
        },
      },
    ]);
    expect(DEFAULT_RULES.length).toBeLessThanOrEqual(4000);
    expect(DEFAULT_RULES).toContain("- Unnecessary `@mentions`");
    expect(DEFAULT_RULES).toContain("## 11 — Moderation");
    expect(DEFAULT_RULES.endsWith("**Not knowing the rules does not exempt you from them.**")).toBe(
      true,
    );
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });

  it("creates a green Rules ✓ role with exactly @everyone permissions before clearing", async () => {
    const f = fixture();
    await f.submit();
    expect(f.guild.roles.create).toHaveBeenCalledExactlyOnceWith({
      name: "Rules ✓",
      colors: { primaryColor: 0x57f287 },
      permissions: f.everyone.permissions.bitfield,
      hoist: false,
      mentionable: false,
      reason: "Rules acceptance role created by User",
    });
    expect(f.guild.roles.create.mock.invocationCallOrder[0]).toBeLessThan(
      f.channel.messages.fetch.mock.invocationCallOrder[0]!,
    );
  });

  it("uses a selected role without creating or modifying it", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedRoles.mockReturnValue(
      new Collection([[f.existingRole.id, { id: f.existingRole.id }]]),
    );
    await f.submit();
    expect(f.guild.roles.fetch).toHaveBeenCalledWith("existing-role", { force: true });
    expect(f.guild.roles.create).not.toHaveBeenCalled();
    expect(f.existingRole.delete).not.toHaveBeenCalled();
    expect(f.channel.send.mock.calls[0]![0].components[0]!.toJSON()).toMatchObject({
      components: [
        { type: ComponentType.TextDisplay },
        { type: ComponentType.Separator },
        { type: ComponentType.TextDisplay },
        {
          type: ComponentType.ActionRow,
          components: [{ custom_id: "rule-accept:guild:existing-role" }],
        },
      ],
    });
  });

  it.each(["member", "bot"] as const)(
    "requires %s Manage Roles before creating or deleting anything",
    async (actor) => {
      const f = fixture();
      f[actor].permissions.remove(P.ManageRoles);
      await expect(f.submit()).rejects.toThrow("Manage Roles");
      expect(f.guild.roles.create).not.toHaveBeenCalled();
      expect(f.guild.channels.create).not.toHaveBeenCalled();
      expect(f.channel.messages.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["managed", "hierarchy", "privileged", "missing", "member-hierarchy"])(
    "rejects a %s existing acceptance role before clearing",
    async (state) => {
      const f = fixture();
      f.interaction.fields.getSelectedRoles.mockReturnValue(
        new Collection([[f.existingRole.id, { id: f.existingRole.id }]]),
      );
      if (state === "managed") f.existingRole.managed = true;
      if (state === "hierarchy") f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
      if (state === "privileged") f.existingRole.permissions.add(P.Administrator);
      if (state === "missing")
        f.guild.roles.fetch.mockResolvedValueOnce(f.everyone).mockResolvedValueOnce(null);
      if (state === "member-hierarchy") f.member.roles.highest.comparePositionTo.mockReturnValue(0);
      await expect(f.submit()).rejects.toThrow();
      expect(f.channel.messages.fetch).not.toHaveBeenCalled();
      expect(f.guild.roles.create).not.toHaveBeenCalled();
    },
  );

  it("exempts the server owner from the publisher's role hierarchy", async () => {
    const f = fixture();
    f.guild.ownerId = f.member.id;
    f.member.roles.highest.comparePositionTo.mockReturnValue(0);
    f.interaction.fields.getSelectedRoles.mockReturnValue(
      new Collection([[f.existingRole.id, { id: f.existingRole.id }]]),
    );
    await f.submit();
    expect(f.channel.send).toHaveBeenCalledOnce();
  });

  it("rejects excessive separators before creating the acceptance role or clearing", async () => {
    const f = fixture();
    f.values.rules = Array.from({ length: 20 }, () => "Section").join("\n---\n");
    await expect(f.submit()).rejects.toThrow("Too many rule sections");
    expect(f.guild.roles.create).not.toHaveBeenCalled();
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it("does not clear the channel if acceptance-role creation fails", async () => {
    const f = fixture();
    f.guild.roles.create.mockRejectedValue(new Error("Cannot create role"));
    await expect(f.submit()).rejects.toThrow("Cannot create role");
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it("cleans up a new role when publication fails, but never deletes a selected role", async () => {
    const f = fixture();
    f.channel.send.mockRejectedValue(new Error("Cannot send"));
    await expect(f.submit()).rejects.toThrow("Cannot send");
    expect(f.role.delete).toHaveBeenCalledOnce();
    f.interaction.fields.getSelectedRoles.mockReturnValue(
      new Collection([[f.existingRole.id, { id: f.existingRole.id }]]),
    );
    await expect(f.submit()).rejects.toThrow("Cannot send");
    expect(f.existingRole.delete).not.toHaveBeenCalled();
  });

  it("publishes edited Markdown in the selected channel without mentions or truncation", async () => {
    const f = fixture();
    f.values.rules = "# Custom rules\n\n@everyone <@123>";
    f.values["channel-name"] = "";
    await f.submit();
    expect(f.guild.channels.fetch).toHaveBeenCalledWith("channel", { force: true });
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const message = f.channel.send.mock.calls[0]![0];
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message.components[0]!.toJSON()).toMatchObject({
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: f.values.rules },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              label: "I understand and agree",
              custom_id: "rule-accept:guild:role",
            },
          ],
        },
      ],
    });
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "Server rules published in <#channel>.",
      allowedMentions: { parse: [] },
    });
  });

  it("keeps the warning and publishes immediately without additional confirmation", async () => {
    const f = fixture();
    await f.open();
    expect(f.interaction.showModal.mock.lastCall![0].toJSON().components[0]).toEqual({
      type: ComponentType.TextDisplay,
      content: RULE_DELETION_WARNING,
    });
    await f.submit();
    expect(f.channel.messages.fetch).toHaveBeenCalledOnce();
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.interaction.reply).not.toHaveBeenCalled();
    expect(f.interaction.showModal).toHaveBeenCalledOnce();
    expect(ruleComponentHandler.matches("rule-next:old-token")).toBe(false);
    expect(ruleComponentHandler.matches("rule-confirm:old-token")).toBe(false);
  });

  it("clears an existing destination before sending replacement rules", async () => {
    const f = fixture();
    await f.submit();
    expect(f.channel.messages.fetch).toHaveBeenCalledWith({ limit: 100 });
    expect(f.channel.messages.fetch.mock.invocationCallOrder[0]).toBeLessThan(
      f.channel.send.mock.invocationCallOrder[0]!,
    );
  });

  it.each(["member", "bot"] as const)(
    "requires %s deletion permissions before clearing",
    async (actor) => {
      const f = fixture();
      f.channel.permissionsFor.mockImplementation(
        (who: unknown) =>
          new PermissionsBitField(
            who === f[actor]
              ? [P.ViewChannel, P.SendMessages]
              : [P.ViewChannel, P.SendMessages, P.ManageMessages, P.ReadMessageHistory],
          ),
      );
      await expect(f.submit()).rejects.toThrow("Manage Messages and Read Message History");
      expect(f.channel.messages.fetch).not.toHaveBeenCalled();
      expect(f.channel.send).not.toHaveBeenCalled();
    },
  );

  it("does not publish if clearing fails and warns about partial deletion", async () => {
    const f = fixture();
    f.channel.messages.fetch.mockRejectedValue(new Error("Cannot fetch"));
    await expect(f.submit()).rejects.toThrow(
      "Some messages may already have been permanently deleted",
    );
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("creates a text channel only when no existing channel is selected", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.values["channel-name"] = " community-rules ";
    await f.submit();
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.channel.messages.fetch).not.toHaveBeenCalled();
    expect(f.guild.channels.create).toHaveBeenCalledWith({
      name: "community-rules",
      type: ChannelType.GuildText,
      permissionOverwrites: [{ id: "bot", allow: [P.ViewChannel, P.SendMessages] }],
      reason: "Rules channel created by User",
    });
    expect(f.channel.send.mock.calls[0]![0].components[0]!.toJSON()).toEqual(
      createRuleComponents(DEFAULT_RULES, { guildId: "guild", roleId: "role" })[0]!.toJSON(),
    );
  });

  it("designates a newly created channel as Rules Channel only in Community mode", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.guild.fetch.mockResolvedValue({ features: [GuildFeature.Community] });
    f.member.permissions.add(P.ManageGuild);
    f.bot.permissions.add(P.ManageGuild);
    await f.submit();
    expect(f.guild.fetch).toHaveBeenCalledOnce();
    expect(f.guild.edit).toHaveBeenCalledExactlyOnceWith({
      rulesChannel: "channel",
      reason: "Community Rules Channel configured by User",
    });
    expect(f.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      f.guild.edit.mock.invocationCallOrder[0]!,
    );
  });

  it("does not designate channels on non-Community servers", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    await f.submit();
    expect(f.guild.fetch).toHaveBeenCalledOnce();
    expect(f.guild.edit).not.toHaveBeenCalled();
  });

  it("never changes the Rules Channel when an existing channel is selected", async () => {
    const f = fixture();
    f.guild.fetch.mockResolvedValue({ features: [GuildFeature.Community] });
    await f.submit();
    expect(f.guild.fetch).not.toHaveBeenCalled();
    expect(f.guild.edit).not.toHaveBeenCalled();
  });

  it.each(["member", "bot"] as const)(
    "requires %s Manage Server before creating a Community rules channel",
    async (actor) => {
      const f = fixture();
      f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
      f.guild.fetch.mockResolvedValue({ features: [GuildFeature.Community] });
      f.member.permissions.add(P.ManageGuild);
      f.bot.permissions.add(P.ManageGuild);
      f[actor].permissions.remove(P.ManageGuild);
      await expect(f.submit()).rejects.toThrow("Manage Server");
      expect(f.guild.channels.create).not.toHaveBeenCalled();
      expect(f.guild.edit).not.toHaveBeenCalled();
    },
  );

  it("deletes the new channel and reports failure if Rules Channel assignment fails", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.guild.fetch.mockResolvedValue({ features: [GuildFeature.Community] });
    f.member.permissions.add(P.ManageGuild);
    f.bot.permissions.add(P.ManageGuild);
    f.guild.edit.mockRejectedValue(new Error("Cannot designate rules channel"));
    await expect(f.submit()).rejects.toThrow("Cannot designate rules channel");
    expect(f.channel.delete).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });

  it("does not assign the Community Rules Channel if publication fails", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.guild.fetch.mockResolvedValue({ features: [GuildFeature.Community] });
    f.member.permissions.add(P.ManageGuild);
    f.bot.permissions.add(P.ManageGuild);
    f.channel.send.mockRejectedValue(new Error("Cannot send"));
    await expect(f.submit()).rejects.toThrow("Cannot send");
    expect(f.guild.edit).not.toHaveBeenCalled();
    expect(f.channel.delete).toHaveBeenCalledOnce();
  });

  it.each(["rule:other:guild", "rule:user:other", "rule:user:guild:extra"])(
    "rejects a foreign or malformed modal %s",
    async (id) => {
      const f = fixture();
      f.interaction.customId = id;
      await expect(f.submit()).rejects.toThrow("another user or server");
      expect(f.channel.send).not.toHaveBeenCalled();
    },
  );

  it("rejects DMs and missing moderator permissions on open and submit", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.open()).rejects.toThrow("server");
    await expect(f.submit()).rejects.toThrow("server");
    f.interaction.inGuild = () => true;
    f.member.permissions.remove(P.ManageChannels);
    await expect(f.open()).rejects.toThrow("Manage Channels");
    await expect(f.submit()).rejects.toThrow("Manage Channels");
  });

  it.each(["", "   ", "x".repeat(4001)])("rejects invalid rules", async (rules) => {
    const f = fixture();
    f.values.rules = rules;
    await expect(f.submit()).rejects.toThrow("between 1 and 4000");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it("requires a name when creating a new channel", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.values["channel-name"] = "   ";
    await expect(f.submit()).rejects.toThrow("new channel name");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });

  it.each(["member", "bot"] as const)("checks %s destination permissions", async (actor) => {
    const f = fixture();
    f.channel.permissionsFor.mockImplementation(
      (who: unknown) =>
        new PermissionsBitField(who === f[actor] ? [] : [P.ViewChannel, P.SendMessages]),
    );
    await expect(f.submit()).rejects.toThrow("View Channel and Send Messages");
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });

  it("requires bot Manage Channels only for channel creation", async () => {
    const f = fixture();
    f.bot.permissions.remove(P.ManageChannels);
    await f.submit();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    await expect(f.submit()).rejects.toThrow("bot needs Manage Channels");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });

  it.each(["missing", "foreign", "wrong-type"])("rejects %s selected channels", async (state) => {
    const f = fixture();
    if (state === "missing") f.guild.channels.fetch.mockResolvedValue(null);
    if (state === "foreign") f.channel.guildId = "other";
    if (state === "wrong-type") f.channel.type = ChannelType.GuildVoice;
    await expect(f.submit()).rejects.toThrow("text channel in this server");
    expect(f.channel.send).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "cleans up only a newly created channel on send failure (new=%s)",
    async (isNew) => {
      const f = fixture();
      if (isNew) f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
      f.channel.send.mockRejectedValue(new Error("Cannot send"));
      await expect(f.submit()).rejects.toThrow("Cannot send");
      expect(f.channel.delete).toHaveBeenCalledTimes(isNew ? 1 : 0);
      expect(f.interaction.editReply).not.toHaveBeenCalled();
    },
  );
});

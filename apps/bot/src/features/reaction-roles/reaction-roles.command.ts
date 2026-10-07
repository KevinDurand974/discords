import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  InteractionContextType,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits as P,
  RoleSelectMenuBuilder,
  SeparatorBuilder,
  SlashCommandBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { CommandDefinition, ComponentHandler, ComponentInteraction } from "@/core/command.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import {
  assertSafeReactionRole,
  parseReactionEmoji,
  type ReactionRoleMapping,
} from "./reaction-role-model.ts";
import { getReactionRoleStore, type ReactionRoleStore } from "./reaction-role-repository.ts";
import {
  createReactionRoleMessagePayload,
  createReactionRoleNotice,
  REACTION_ROLE_TITLE,
} from "./reaction-role-messages.ts";

export type ReactionRoleDraft = {
  userId: string;
  guildId: string;
  channelId: string;
  content: string;
  mappings: ReactionRoleMapping[];
};
type PendingDraft = ReactionRoleDraft & {
  expiresAt: number;
  messageId?: string;
  publishing: boolean;
};
const DRAFT_TTL = 15 * 60 * 1000;

function assertCanConfigure(interaction: ChatInputCommandInteraction | ComponentInteraction) {
  if (!interaction.inGuild() || !interaction.guild)
    throw new Error("Use reaction roles in a server.");
  if (!interaction.memberPermissions?.has(P.ManageRoles)) throw new Error("You need Manage Roles.");
}

export function createReactionRolesModal(userId: string, guildId: string, channelId: string) {
  return new ModalBuilder()
    .setCustomId(`reaction-roles:setup:${userId}:${guildId}:${channelId}`)
    .setTitle("Reaction roles")
    .addLabelComponents(
      new LabelBuilder()
        .setId(1)
        .setLabel("Destination channel")
        .setChannelSelectMenuComponent(
          new ChannelSelectMenuBuilder()
            .setId(2)
            .setCustomId("channel")
            .setChannelTypes(ChannelType.GuildText)
            .setDefaultChannels(channelId)
            .setRequired(false)
            .setMinValues(0)
            .setMaxValues(1),
        ),
      new LabelBuilder()
        .setId(3)
        .setLabel("Message content")
        .setTextInputComponent(
          new TextInputBuilder()
            .setId(4)
            .setCustomId("content")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000),
        ),
    );
}

export function createReactionRoleEntryModal(draftId: string) {
  return new ModalBuilder()
    .setCustomId(`reaction-roles:entry:${draftId}`)
    .setTitle("Add a reaction role")
    .addLabelComponents(
      new LabelBuilder()
        .setId(1)
        .setLabel("Emoji")
        .setDescription("Exactly one emoji. Combined emojis such as ❤️ and 👍🏽 are accepted.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setId(2)
            .setCustomId("emoji")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(100),
        ),
      new LabelBuilder()
        .setId(3)
        .setLabel("Role")
        .setRoleSelectMenuComponent(
          new RoleSelectMenuBuilder()
            .setId(4)
            .setCustomId("role")
            .setRequired(true)
            .setMinValues(1)
            .setMaxValues(1),
        ),
    );
}

export function createReactionRolePreview(draftId: string, draft: ReactionRoleDraft) {
  const payload = createReactionRoleMessagePayload(draft.content);
  const footer = `Preview • <#${draft.channelId}>\n⚠️ Anyone who can react can obtain these roles and all their permissions, including Administrator.\nExpires after 15 minutes. Nothing is published until you validate.`;
  const heading = "**Configured reactions**\n";
  const lines: string[] = [];
  // Components V2 limits total TextDisplay content to 4000 characters per message.
  const budget =
    4000 - REACTION_ROLE_TITLE.length - draft.content.length - footer.length - heading.length - 40;
  for (const mapping of draft.mappings) {
    const line = `${mapping.emoji} → <@&${mapping.roleId}>`;
    if ([...lines, line].join("\n").length > budget) break;
    lines.push(line);
  }
  const remaining = draft.mappings.length - lines.length;
  const mappings = draft.mappings.length
    ? `${lines.join("\n")}${remaining ? `\n… ${remaining} more configured.` : ""}`
    : "No reactions yet. Validate without reactions to cancel.";
  payload.components[0]!.addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(heading + mappings))
    .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
  return {
    ...payload,
    components: [
      ...payload.components,
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`reaction-roles:add:${draftId}`)
          .setLabel("Add")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(draft.mappings.length >= 20),
        new ButtonBuilder()
          .setCustomId(`reaction-roles:validate:${draftId}`)
          .setLabel("Validate")
          .setStyle(ButtonStyle.Success),
      ),
    ],
  };
}

export async function publishReactionRoles(
  interaction: ComponentInteraction,
  store: ReactionRoleStore,
  draft: ReactionRoleDraft,
) {
  assertCanConfigure(interaction);
  const guild = interaction.guild!;
  if (draft.userId !== interaction.user.id || draft.guildId !== guild.id)
    throw new Error("This preview belongs to another user or server.");
  const { content, channelId, mappings } = draft;
  if (!content.trim() || content.length > 2000)
    throw new Error("Enter 1–2000 characters for the message.");
  if (!mappings.length || mappings.length > 20)
    throw new Error("Add 1–20 reactions before publishing.");
  const [channel, bot, publisher] = await Promise.all([
    guild.channels.fetch(channelId),
    guild.members.fetchMe(),
    guild.members.fetch({ user: interaction.user.id, force: true }),
  ]);
  if (!publisher.permissions.has(P.ManageRoles)) throw new Error("You need Manage Roles.");
  if (!channel || channel.type !== ChannelType.GuildText)
    throw new Error("Choose a text channel in this server.");
  if (!channel.permissionsFor(publisher)?.has([P.ViewChannel, P.SendMessages]))
    throw new Error("You need View Channel and Send Messages in the destination.");
  if (
    !bot.permissions.has(P.ManageRoles) ||
    !channel
      .permissionsFor(bot)
      ?.has([P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AddReactions, P.ManageMessages])
  ) {
    throw new Error(
      "I need Manage Roles, plus View Channel, Send Messages, Read Message History, Add Reactions and Manage Messages in the destination.",
    );
  }
  await guild.emojis.fetch();
  await Promise.all(
    mappings.map(async (mapping) => {
      const role = await guild.roles.fetch(mapping.roleId, { force: true });
      if (!role) throw new Error("One of the selected roles no longer exists.");
      assertSafeReactionRole(role, bot, publisher);
      if (/^\d+$/.test(mapping.key) && !guild.emojis.cache.get(mapping.key)?.available)
        throw new Error("Use available custom emojis from this server.");
    }),
  );
  const message = await channel.send(createReactionRoleMessagePayload(content, mappings));
  let saved = false;
  try {
    await store.save({ messageId: message.id, guildId: guild.id, channelId, mappings });
    saved = true;
    await mappings.reduce(async (previous, mapping) => {
      await previous;
      await message.react(mapping.emoji);
    }, Promise.resolve());
  } catch (error) {
    const results = await Promise.allSettled([
      ...(saved ? [store.remove(message.id)] : []),
      message.delete(),
    ]);
    if (results.some((result) => result.status === "rejected")) {
      console.error("Reaction role setup cleanup failed", results);
      throw new Error("Setup failed. Please delete the incomplete message and try again.", {
        cause: error,
      });
    }
    throw error;
  }
}

export function createReactionRolesComponentHandler(
  getStore: () => ReactionRoleStore = getReactionRoleStore,
): ComponentHandler {
  const drafts = new Map<string, PendingDraft>();
  function pruneDrafts() {
    drafts.forEach((draft, id) => {
      if (draft.expiresAt <= Date.now() && !draft.publishing) drafts.delete(id);
    });
  }
  return {
    matches: (customId) => customId.startsWith("reaction-roles:"),
    async execute(interaction) {
      assertCanConfigure(interaction);
      pruneDrafts();
      const guild = interaction.guild!;
      if (interaction.isModalSubmit() && interaction.customId.startsWith("reaction-roles:setup:")) {
        const match = /^reaction-roles:setup:(\d+):(\d+):(\d+)$/.exec(interaction.customId);
        if (!match || match[1] !== interaction.user.id || match[2] !== guild.id)
          throw new Error("This form has expired. Run /reaction-roles again.");
        const content = interaction.fields.getTextInputValue("content").trim();
        if (!content || content.length > 2000)
          throw new Error("Enter 1–2000 characters for the message.");
        const channelId =
          interaction.fields.getSelectedChannels("channel", false, [ChannelType.GuildText])?.first()
            ?.id ?? match[3]!;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const channel = await guild.channels.fetch(channelId);
        if (!channel || channel.type !== ChannelType.GuildText)
          throw new Error("Choose a text channel in this server.");
        const id = randomUUID();
        const draft: PendingDraft = {
          userId: interaction.user.id,
          guildId: guild.id,
          channelId,
          content,
          mappings: [],
          expiresAt: Date.now() + DRAFT_TTL,
          publishing: false,
        };
        drafts.set(id, draft);
        try {
          const preview = await interaction.editReply(createReactionRolePreview(id, draft));
          draft.messageId = preview.id;
        } catch (error) {
          drafts.delete(id);
          throw error;
        }
        return;
      }
      const match = /^reaction-roles:(add|validate|entry):([a-f0-9-]{36})$/.exec(
        interaction.customId,
      );
      const draft = match ? drafts.get(match[2]!) : undefined;
      if (!match || !draft || draft.expiresAt <= Date.now())
        throw new Error("This preview has expired. Run /reaction-roles again.");
      if (draft.userId !== interaction.user.id || draft.guildId !== guild.id)
        throw new Error("This preview belongs to another user or server.");
      if (draft.publishing) throw new Error("This message is already being published.");
      const id = match[2]!;
      if (interaction.isButton()) {
        if (interaction.message.id !== draft.messageId)
          throw new Error("Invalid reaction roles preview.");
        if (match[1] === "add") {
          if (draft.mappings.length >= 20) throw new Error("You can add at most 20 reactions.");
          await interaction.showModal(createReactionRoleEntryModal(id));
        } else if (match[1] === "validate") {
          draft.publishing = true;
          try {
            await interaction.deferUpdate();
            if (!draft.mappings.length) {
              drafts.delete(id);
              await editSuccessReply(
                interaction,
                createReactionRoleNotice("Cancelled. No reactions were configured."),
              );
              return;
            }
            await publishReactionRoles(interaction, getStore(), {
              ...draft,
              mappings: [...draft.mappings],
            });
            drafts.delete(id);
            await editSuccessReply(
              interaction,
              createReactionRoleNotice(`Reaction roles published in <#${draft.channelId}>.`),
            );
          } finally {
            draft.publishing = false;
          }
        }
        return;
      }
      if (
        match[1] !== "entry" ||
        !interaction.isModalSubmit() ||
        !interaction.isFromMessage() ||
        interaction.message.id !== draft.messageId
      )
        throw new Error("Invalid reaction roles form.");
      const emoji = parseReactionEmoji(interaction.fields.getTextInputValue("emoji"));
      const roleId = interaction.fields.getSelectedRoles("role", true).first()?.id;
      if (!roleId) throw new Error("Select one role.");
      await interaction.deferUpdate();
      const [role, bot, publisher] = await Promise.all([
        guild.roles.fetch(roleId, { force: true }),
        guild.members.fetchMe(),
        guild.members.fetch({ user: interaction.user.id, force: true }),
      ]);
      if (!publisher.permissions.has(P.ManageRoles)) throw new Error("You need Manage Roles.");
      if (!role) throw new Error("The selected role no longer exists.");
      assertSafeReactionRole(role, bot, publisher);
      if (draft.publishing || !drafts.has(id) || draft.expiresAt <= Date.now())
        throw new Error("This preview is no longer available. Run /reaction-roles again.");
      if (draft.mappings.length >= 20) throw new Error("You can add at most 20 reactions.");
      if (draft.mappings.some((mapping) => mapping.key === emoji.key))
        throw new Error("This emoji is already configured.");
      draft.mappings.push({ ...emoji, roleId });
      await interaction.editReply(createReactionRolePreview(id, draft));
    },
  };
}

export const reactionRolesCommand = {
  helpDescription: [
    "Choose a destination text channel (default: current) and message content in a modal. The Components V2 message is titled Choose your roles, with your entered text as its description. The private preview has Add and Validate buttons. Add opens a form with exactly one emoji and a role selector; up to 20 unique emojis. Combined Unicode emojis are accepted. No role mentions need to be typed.",
    "Validate publishes the message, or cancels if no reactions exist. Previews expire after 15 minutes or a bot restart. Requires Manage Roles and destination View Channel/Send Messages. Roles may have permissions, including Administrator. Anyone who can react can obtain those permissions. Roles must be unmanaged and below the bot/publisher (server owner exempt from publisher hierarchy).",
    "Bot needs Manage Roles and destination View Channel, Send Messages, Read Message History, Add Reactions, Manage Messages. Each click toggles the role and removes the user's reaction. Unconfigured reactions are automatically removed. Published mappings persist across restarts. Example: /reaction-roles",
  ],
  data: new SlashCommandBuilder()
    .setName("reaction-roles")
    .setDescription("Publish a message with reaction role toggles")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(P.ManageRoles),
  async execute(interaction) {
    assertCanConfigure(interaction);
    if (interaction.channel?.type !== ChannelType.GuildText)
      throw new Error("Run this command in a server text channel.");
    await interaction.showModal(
      createReactionRolesModal(interaction.user.id, interaction.guildId!, interaction.channelId),
    );
  },
} satisfies CommandDefinition;

export const reactionRolesComponentHandler = createReactionRolesComponentHandler();

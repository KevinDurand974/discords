import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type ButtonInteraction,
} from "discord.js";
import type { CommandDefinition, ComponentHandler } from "@/core/command.ts";
import { createVideosRuntime } from "./videos-runtime.ts";

type Actor = ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction;
type Session = { guildId: string; userId: string; expires: number } & (
  | { kind: "add"; count: number }
  | { kind: "clean"; forumId: string | null; generation: number }
);
const sessions = new Map<string, Session>();
export function requireVideoPermission(
  interaction: Actor,
  admin = false,
): asserts interaction is Actor & { guild: Guild; guildId: string } {
  if (!interaction.guild || !interaction.guildId)
    throw new Error("Videos can only be managed in a server.");
  const permission = admin ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageMessages;
  if (
    interaction.user.id !== interaction.guild.ownerId &&
    !interaction.memberPermissions?.has(permission)
  )
    throw new Error(
      admin
        ? "Only an administrator can clean video resources."
        : "You need Manage Messages to manage videos.",
    );
}
type SessionInput =
  | Omit<Extract<Session, { kind: "add" }>, "expires">
  | Omit<Extract<Session, { kind: "clean" }>, "expires">;
function createSession(session: SessionInput) {
  sessions.forEach((value, key) => {
    if (value.expires < Date.now()) sessions.delete(key);
  });
  const id = randomUUID();
  sessions.set(id, { ...session, expires: Date.now() + 300_000 });
  return id;
}
function consumeSession(interaction: Actor & { guildId: string }, kind: Session["kind"]) {
  const id = "customId" in interaction ? interaction.customId.split(":").at(-1)! : "";
  const pending = sessions.get(id);
  if (
    !pending ||
    pending.kind !== kind ||
    pending.expires < Date.now() ||
    pending.guildId !== interaction.guildId ||
    pending.userId !== interaction.user.id
  )
    throw new Error(
      "This form/confirmation expired or belongs to another user; run /videos again.",
    );
  sessions.delete(id);
  return pending;
}
export const videosCommand = {
  data: new SlashCommandBuilder()
    .setName("videos")
    .setDescription("Track YouTube guide videos")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Track a creator and import their latest videos")
        .addIntegerOption((option) =>
          option
            .setName("backfill-count")
            .setDescription("Initial videos to publish (0–15, default 10)")
            .setMinValue(0)
            .setMaxValue(15),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("status").setDescription("Show creators and publication progress"),
    )
    .addSubcommand((sub) =>
      sub.setName("sync").setDescription("Publish pending videos already collected by the API"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("clean")
        .setDescription("Administrator: delete the video Forum and server tracking"),
    ),
  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    requireVideoPermission(interaction, action === "clean");
    if (action === "add") {
      const count = interaction.options.getInteger("backfill-count") ?? 10;
      const token = createSession({
        kind: "add",
        guildId: interaction.guildId,
        userId: interaction.user.id,
        count,
      });
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`videos:add:${token}`)
          .setTitle("Track a YouTube creator")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("channel-url")
                .setLabel("YouTube channel URL, @handle or UC… ID")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(2048)
                .setRequired(true),
            ),
          ),
      );
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const runtime = createVideosRuntime(interaction.client);
    if (action === "sync") {
      const result = await runtime.sync(interaction.guildId);
      await interaction.editReply(
        `Published ${result.published}; failed ${result.failures.length}. Failed publications remain retryable; check /videos status.`,
      );
      return;
    }
    const setup = await runtime.store.get(interaction.guildId);
    if (!setup) {
      await interaction.editReply("Videos are not configured; use /videos add.");
      return;
    }
    if (action === "status") {
      const tracked = await runtime.store.subscriptions(interaction.guildId);
      const creators = tracked
        .map(
          ({ creator }) =>
            `${creator.displayName.slice(0, 40)} — ${creator.lastSyncedAt?.toISOString() ?? "not synced"}${creator.lastError ? ` (${creator.lastError})` : ""}`,
        )
        .join("\n");
      await interaction.editReply({
        content:
          `Latest Videos: ${setup.forumChannelId ? `<#${setup.forumChannelId}>` : "provisioning pending"} (${setup.lifecycle})\n${await runtime.store.counts(interaction.guildId)}\n${creators}`.slice(
            0,
            1950,
          ),
        allowedMentions: { parse: [] },
      });
      return;
    }
    const token = createSession({
      kind: "clean",
      guildId: interaction.guildId,
      userId: interaction.user.id,
      forumId: setup.forumChannelId,
      generation: setup.forumGeneration,
    });
    await interaction.editReply({
      content: `**Permanent deletion**\nForum: ${setup.forumChannelId ? `<#${setup.forumChannelId}> (ID ${setup.forumChannelId})` : "not yet created"}. All posts/messages/tags and this server's tracking will be removed.\n${await runtime.store.counts(interaction.guildId)}\nNo roles, global YouTube history or other servers are affected. Confirm within 5 minutes.`,
      allowedMentions: { parse: [] },
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`videos:clean:${token}`)
            .setLabel("Delete video Forum and tracking")
            .setStyle(ButtonStyle.Danger),
        ),
      ],
    });
  },
} satisfies CommandDefinition;

export const videosComponentHandler: ComponentHandler = {
  matches: (customId) => customId.startsWith("videos:add:") || customId.startsWith("videos:clean:"),
  async execute(interaction) {
    const clean = interaction.customId.startsWith("videos:clean:");
    if (clean ? !interaction.isButton() : !interaction.isModalSubmit()) return;
    requireVideoPermission(interaction, clean);
    const pending = consumeSession(interaction, clean ? "clean" : "add");
    if (pending.kind === "add" && interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const result = await createVideosRuntime(interaction.client).add(
        interaction.guildId,
        interaction.fields.getTextInputValue("channel-url"),
        pending.count,
      );
      await interaction.editReply({
        content: `${result.reused ? "Creator reused" : "Creator added"} in <#${result.forumId}>. Published ${result.published}; failed ${result.failures.length}.`,
        allowedMentions: { parse: [] },
      });
    } else if (pending.kind === "clean" && interaction.isButton()) {
      await interaction.deferUpdate();
      try {
        await createVideosRuntime(interaction.client).clean(
          interaction.guildId,
          pending.forumId,
          pending.generation,
        );
        await interaction.editReply({
          content:
            "Video Forum and this server's tracking removed. Shared YouTube history is retained.",
          components: [],
        });
      } catch {
        await interaction.editReply({
          content:
            "Cleanup is incomplete; saved resource IDs are retained. Check bot permissions and run /videos clean again to retry.",
          components: [],
        });
      }
    }
  },
};

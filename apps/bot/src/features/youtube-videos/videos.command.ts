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
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Guild,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type SlashCommandSubcommandBuilder,
} from "discord.js";
import type { CommandDefinition, ComponentHandler } from "@/core/command.ts";
import { createVideosRuntime } from "./videos-runtime.ts";

type Actor = ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction;
type Session = { guildId: string; userId: string; expires: number } & (
  | { kind: "add"; count: number }
  | { kind: "clean"; forumId: string | null; generation: number; tagId?: string }
);
const sessions = new Map<string, Session>();
export function requireVideoPermission(
  interaction: Actor,
  admin = false,
): asserts interaction is Actor & { guild: Guild; guildId: string } {
  if (!interaction.guild || !interaction.guildId)
    throw new Error("YouTube can only be managed in a server.");
  const permission = admin ? PermissionFlagsBits.Administrator : PermissionFlagsBits.ManageMessages;
  if (
    interaction.user.id !== interaction.guild.ownerId &&
    !interaction.memberPermissions?.has(permission)
  )
    throw new Error(
      admin
        ? "Only an administrator can clean YouTube resources."
        : "You need Manage Messages to manage YouTube.",
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
      "This form/confirmation expired or belongs to another user; run the command again.",
    );
  sessions.delete(id);
  return pending;
}

export const configureYoutubeSetup = (sub: SlashCommandSubcommandBuilder) =>
  sub.setName("setup").setDescription("Create or repair the default YouTube Forum");
export const configureYoutubeClean = (sub: SlashCommandSubcommandBuilder) =>
  sub
    .setName("clean")
    .setDescription("Administrator: clean YouTube videos or resources")
    .addStringOption((option) =>
      option
        .setName("tag")
        .setDescription("Creator tag; omit to clean all creators")
        .setAutocomplete(true),
    );
export async function autocompleteYoutubeTag(interaction: AutocompleteInteraction) {
  if (
    !interaction.guildId ||
    !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
  ) {
    await interaction.respond([]);
    return;
  }
  const search = interaction.options.getFocused().toLowerCase();
  const tags = await createVideosRuntime(interaction.client).creatorTags(interaction.guildId);
  await interaction.respond(
    tags
      .filter((tag) => tag.name.toLowerCase().includes(search))
      .slice(0, 25)
      .map((tag) => ({ name: tag.name.slice(0, 100), value: tag.id })),
  );
}
export async function handleYoutubeSetup(interaction: ChatInputCommandInteraction) {
  if (!interaction.guild || !interaction.guildId)
    throw new Error("YouTube can only be configured in a server.");
  const clean = interaction.options.getSubcommand() === "clean";
  if (clean) requireVideoPermission(interaction, true);
  else {
    if (
      interaction.user.id !== interaction.guild.ownerId &&
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
    )
      throw new Error("You need Manage Channels to configure the YouTube Forum.");
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const runtime = createVideosRuntime(interaction.client);
  if (!clean) {
    const { forum } = await runtime.setup(interaction.guildId);
    await interaction.editReply({
      content: `YouTube Forum ready: <#${forum.id}>. Use /youtube add to track a creator.`,
      allowedMentions: { parse: [] },
    });
    return;
  }
  const setup = await runtime.store.get(interaction.guildId);
  if (!setup) {
    await interaction.editReply("YouTube is not configured; use /youtube setup.");
    return;
  }
  const tagId = interaction.options.getString("tag") ?? undefined;
  const tag = tagId
    ? (await runtime.creatorTags(interaction.guildId)).find((item) => item.id === tagId)
    : undefined;
  if (tagId && !tag) throw new Error("Choose a current creator tag from the suggested list.");
  const token = createSession({
    kind: "clean",
    guildId: interaction.guildId,
    userId: interaction.user.id,
    forumId: setup.forumChannelId,
    generation: setup.forumGeneration,
    ...(tagId ? { tagId } : {}),
  });
  const resources = tag
    ? "Delete this creator's videos, owned tag and tracking; keep the Forum and other creators."
    : setup.ownsForum
      ? "Delete the Forum, all its posts/tags and this server's YouTube tracking."
      : "Delete managed videos, owned creator tags and YouTube tracking; keep the user-selected Forum and unrelated posts/tags.";
  await interaction.editReply({
    content: `**Permanent deletion — choose what to remove**\nForum: ${setup.forumChannelId ? `<#${setup.forumChannelId}>` : "missing"}. Scope: ${tag ? tag.name : "all creators"}.\n**Videos only:** delete managed video posts; retain the Forum, tags and subscriptions for future videos. Deleted videos will not be reposted.\n**Everything in scope:** ${resources}\nGlobal YouTube history and other servers are unaffected. Confirm within 5 minutes.`,
    allowedMentions: { parse: [] },
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`youtube:clean:videos:${token}`)
          .setLabel("Delete videos only")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`youtube:clean:resources:${token}`)
          .setLabel("Delete everything in scope")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`youtube:cancel:${token}`)
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  });
}
export const youtubeHelpDescription = [
  "setup: Create or repair the default YouTube forum without adding a creator. Requires Manage Channels or server ownership.",
  "clean: Administrator/server-owner cleanup with a user-bound confirmation lasting 5 minutes. With tag, scopes cleanup to that creator; without tag, affects all tracked creators. Choose Videos only or Everything in scope. Deletion is permanent; user-owned forums and unrelated content are preserved.",
  "add: Opens a creator (URL, handle or channel ID) and forum-selection modal. Backfill count is 0–15, default 10; 0 follows only future videos. No forum is created implicitly.",
  "status: Shows the configured forum, followed creators and publication status. sync: Publishes already-collected pending videos; does not trigger fresh RSS collection.",
  "Requires Manage Messages, administrator access or server ownership. One forum is used per server; changing it while creators are followed requires removing that tracking first with /youtube clean. User-owned forum permissions are not rewritten.",
  "Example: `/youtube add backfill-count:10`",
] as const;

export const youtubeCommand = {
  helpDescription: youtubeHelpDescription,
  data: new SlashCommandBuilder()
    .setName("youtube")
    .setDescription("Track YouTube guide videos")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand(configureYoutubeSetup)
    .addSubcommand(configureYoutubeClean)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Track a creator in the selected YouTube Forum")
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
    ),
  autocomplete: autocompleteYoutubeTag,
  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    if (action === "setup" || action === "clean") {
      await handleYoutubeSetup(interaction);
      return;
    }
    requireVideoPermission(interaction);
    const runtime = createVideosRuntime(interaction.client);
    if (action === "add") {
      const setup = await runtime.store.get(interaction.guildId);
      const token = createSession({
        kind: "add",
        guildId: interaction.guildId,
        userId: interaction.user.id,
        count: interaction.options.getInteger("backfill-count") ?? 10,
      });
      const select = new ChannelSelectMenuBuilder()
        .setCustomId("forum-channel")
        .setChannelTypes(ChannelType.GuildForum)
        .setMinValues(1)
        .setMaxValues(1)
        .setRequired(true);
      if (setup?.forumChannelId && setup.lifecycle === "active")
        select.setDefaultChannels(setup.forumChannelId);
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`youtube:add:${token}`)
          .setTitle("Track a YouTube creator")
          .addLabelComponents(
            new LabelBuilder()
              .setLabel("YouTube channel URL, @handle or UC… ID")
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId("channel-url")
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(2048)
                  .setRequired(true),
              ),
            new LabelBuilder()
              .setLabel("YouTube Forum")
              .setDescription("One Forum per server; the configured Forum is selected by default.")
              .setChannelSelectMenuComponent(select),
          ),
      );
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === "sync") {
      const result = await runtime.sync(interaction.guildId);
      await interaction.editReply(
        `Published ${result.published}; failed ${result.failures.length}. Failed publications remain retryable; check /youtube status.`,
      );
      return;
    }
    const setup = await runtime.store.get(interaction.guildId);
    if (!setup) {
      await interaction.editReply(
        "YouTube is not configured; use /youtube setup or choose an existing Forum in /youtube add.",
      );
      return;
    }
    const tracked = await runtime.store.subscriptions(interaction.guildId);
    const creators = tracked
      .map(
        ({ creator }) =>
          `${creator.displayName.slice(0, 40)} — ${creator.lastSyncedAt?.toISOString() ?? "not synced"}${creator.lastError ? ` (${creator.lastError})` : ""}`,
      )
      .join("\n");
    await interaction.editReply({
      content:
        `YouTube: ${setup.forumChannelId ? `<#${setup.forumChannelId}>` : "setup required"} (${setup.lifecycle})\n${await runtime.store.counts(interaction.guildId)}\n${creators}`.slice(
          0,
          1950,
        ),
      allowedMentions: { parse: [] },
    });
  },
} satisfies CommandDefinition;

export const youtubeComponentHandler: ComponentHandler = {
  matches: (customId) =>
    customId.startsWith("youtube:add:") ||
    customId.startsWith("youtube:clean:") ||
    customId.startsWith("youtube:cancel:"),
  async execute(interaction) {
    const clean = !interaction.customId.startsWith("youtube:add:");
    if (clean ? !interaction.isButton() : !interaction.isModalSubmit()) return;
    requireVideoPermission(interaction, clean);
    const pending = consumeSession(interaction, clean ? "clean" : "add");
    if (pending.kind === "add" && interaction.isModalSubmit()) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const channels = interaction.fields.getSelectedChannels("forum-channel", true, [
        ChannelType.GuildForum,
      ]);
      const forumId = channels.first()?.id;
      if (!forumId) throw new Error("Choose a Forum channel in this server.");
      const result = await createVideosRuntime(interaction.client).add(
        interaction.guildId,
        interaction.fields.getTextInputValue("channel-url"),
        pending.count,
        forumId,
      );
      await interaction.editReply({
        content: `${result.reused ? "Creator reused" : "Creator added"} in <#${result.forumId}>. Published ${result.published}; failed ${result.failures.length}.`,
        allowedMentions: { parse: [] },
      });
    } else if (pending.kind === "clean" && interaction.isButton()) {
      await interaction.deferUpdate();
      if (interaction.customId.startsWith("youtube:cancel:")) {
        await interaction.editReply({
          content: "Cleanup cancelled; nothing was deleted.",
          components: [],
        });
        return;
      }
      const mode = interaction.customId.split(":")[2];
      if (mode !== "videos" && mode !== "resources") throw new Error("Invalid cleanup choice.");
      try {
        await createVideosRuntime(interaction.client).clean(
          interaction.guildId,
          pending.forumId,
          pending.generation,
          mode,
          pending.tagId,
        );
        await interaction.editReply({
          content:
            mode === "videos"
              ? "Video posts removed. Forum, creator tags and tracking retained for future videos."
              : "Selected YouTube resources and tracking removed. Shared YouTube history is retained.",
          components: [],
        });
      } catch {
        await interaction.editReply({
          content:
            "Cleanup is incomplete or resources changed. Check bot permissions and run /youtube clean with the same scope again to retry.",
          components: [],
        });
      }
    }
  },
};

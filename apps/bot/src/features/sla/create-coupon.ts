import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { couponItems, displayEmoji } from "@/shared/emojis/emoji-cache.ts";
import { CLAIM_BUTTON_PREFIX } from "./claim-components.ts";

const itemEntries = Object.entries(couponItems).sort(([left], [right]) =>
  left.localeCompare(right, "en"),
);
export const COUPON_ITEMS = itemEntries.map(([, emojiName]) => emojiName);
const itemLabels = new Map(itemEntries.map(([label, emojiName]) => [emojiName, label]));
export function autocompleteCouponItems(query: string, excludedItems: readonly string[] = []) {
  const search = query.trim().toLowerCase().replaceAll("_", " ");
  const excluded = new Set(excludedItems);
  return itemEntries
    .filter(
      ([label, emojiName]) =>
        !excluded.has(emojiName) &&
        (label.toLowerCase().includes(search) ||
          emojiName.toLowerCase().replaceAll("_", " ").includes(search)),
    )
    .slice(0, 25)
    .map(([name, value]) => ({ name, value }));
}
type CouponItem = (typeof COUPON_ITEMS)[number];
export type CouponReward = { item: CouponItem; quantity: number };
const PREFIX = "sla:create-coupon:";
const DRAFT_TTL_MS = 300_000;
const THUMBNAIL = "https://cdn.discordapp.com/emojis/1556396384461262899.webp";
const CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;
type Actor = ButtonInteraction | ModalSubmitInteraction | ChatInputCommandInteraction;
type Draft = {
  userId: string;
  guildId: string;
  expires: number;
  code: string;
  channelId: string;
  items: { index: number; item: CouponItem; quantity: number | null }[];
  page: number;
  stage: "start" | "ready" | "publishing";
  revision: number;
  quantityForm: { index: number; revision: number } | null;
};
const drafts = new Map<string, Draft>();
function assertGuild(interaction: Actor): asserts interaction is Actor & { guildId: string } {
  if (!interaction.guild || !interaction.guildId)
    throw new Error("Create a coupon in a server channel.");
}
function validateCode(value: string) {
  const code = value.trim();
  if (!code || /[`\r\n]/.test(code))
    throw new Error("Enter a coupon code without backticks or line breaks.");
  if (`${CLAIM_BUTTON_PREFIX}${encodeURIComponent(code)}`.length > 100)
    throw new Error("Coupon code is too long for the Claim button.");
  return code;
}
export function parseCouponReward(item: string | undefined, quantity: string): CouponReward | null {
  const value = quantity.trim();
  if (!item && !value) return null;
  if (
    !item ||
    !COUPON_ITEMS.some((allowed) => allowed === item) ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  ) {
    throw new Error(
      "Choose an item and enter a positive whole-number quantity, or leave both fields empty.",
    );
  }
  return { item: item as CouponItem, quantity: Number(value) };
}
export function renderCouponCard(code: string, rewards: readonly CouponReward[]) {
  const validatedCode = validateCode(code);
  const card = new ContainerBuilder()
    .setAccentColor(0x411b4f)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent("# Claim coupon"),
          new TextDisplayBuilder().setContent(`\`\`\`\n${validatedCode}\n\`\`\``),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(THUMBNAIL).setDescription("Coupon reward"),
        ),
    );
  if (rewards.length) {
    card
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true))
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `## Rewards\n${rewards
            .map(
              ({ item, quantity }) =>
                `**${displayEmoji(item)} x${Intl.NumberFormat("en-US").format(quantity)}**`,
            )
            .join("\n")}`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }
  return card.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CLAIM_BUTTON_PREFIX}${encodeURIComponent(validatedCode)}`)
        .setLabel("Claim")
        .setStyle(ButtonStyle.Primary),
    ),
  );
}
function button(token: string, action: string, label: string, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(`${PREFIX}${action}:${token}`)
    .setLabel(label)
    .setStyle(style);
}
function draftView(token: string, draft: Draft) {
  const configured = draft.items.filter(({ quantity }) => quantity !== null).length;
  const missing = draft.items.length - configured;
  const card = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# Create coupon\n\`\`\`\n${draft.code}\n\`\`\`\nPost in <#${draft.channelId}>. ${configured}/${draft.items.length} quantities configured.\nThis draft expires after 5 minutes.`,
    ),
  );
  if (draft.items.length) {
    card
      .addSeparatorComponents(new SeparatorBuilder())
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          missing
            ? "Set a positive whole-number quantity for every selected item before publishing."
            : "All quantities are set. You can edit them or publish the coupon.",
        ),
      );
    for (const { index, item, quantity } of draft.items.slice(draft.page * 4, draft.page * 4 + 4)) {
      card.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**Item ${index + 1}** — ${displayEmoji(item)} ${itemLabels.get(item)}${quantity === null ? " — Quantity required" : ` x${Intl.NumberFormat("en-US").format(quantity)}`}`,
            ),
          )
          .setButtonAccessory(
            button(
              token,
              `quantity-${index}`,
              quantity === null ? "Set quantity" : "Edit quantity",
              ButtonStyle.Primary,
            ),
          ),
      );
    }
  }
  const controls = new ActionRowBuilder<ButtonBuilder>();
  if (draft.items.length > 4)
    controls.addComponents(
      button(token, "page", draft.page === 0 ? "Next items" : "Previous items"),
    );
  controls.addComponents(
    button(
      token,
      "publish",
      draft.items.length ? `Publish (${draft.items.length} items)` : "Publish without items",
      ButtonStyle.Success,
    ).setDisabled(missing > 0),
    button(token, "cancel", "Cancel", ButtonStyle.Danger),
  );
  card.addActionRowComponents(controls);
  return {
    components: [card],
    allowedMentions: { parse: [] as const },
    flags: MessageFlags.IsComponentsV2 as const,
  };
}
async function dismissResponse(interaction: ButtonInteraction) {
  await interaction.deleteReply().catch(() => {});
}
export async function handleCreateCoupon(interaction: ChatInputCommandInteraction) {
  assertGuild(interaction);
  const items: Draft["items"] = [];
  for (let index = 0; index < 8; index++) {
    const item = interaction.options.getString(`item_${index + 1}`);
    if (item === null) continue;
    if (!COUPON_ITEMS.some((allowed) => allowed === item))
      throw new Error(`Choose item_${index + 1} from the coupon autocomplete suggestions.`);
    if (items.some((selected) => selected.item === item))
      throw new Error("Choose each coupon item only once.");
    items.push({ index, item: item as CouponItem, quantity: null });
  }
  drafts.forEach((draft, token) => {
    if (draft.expires <= Date.now()) drafts.delete(token);
  });
  const token = randomUUID();
  const channel = new ChannelSelectMenuBuilder()
    .setCustomId("channel")
    .setChannelTypes(...CHANNEL_TYPES)
    .setMinValues(1)
    .setMaxValues(1)
    .setRequired(true);
  if (interaction.channel && CHANNEL_TYPES.some((type) => type === interaction.channel?.type))
    channel.setDefaultChannels(interaction.channelId);
  drafts.set(token, {
    userId: interaction.user.id,
    guildId: interaction.guildId,
    expires: Date.now() + DRAFT_TTL_MS,
    code: "",
    channelId: "",
    items,
    page: 0,
    stage: "start",
    revision: 0,
    quantityForm: null,
  });
  try {
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`${PREFIX}start:${token}`)
        .setTitle("Create coupon")
        .addLabelComponents(
          new LabelBuilder()
            .setLabel("Coupon code")
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId("code")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMaxLength(80),
            ),
          new LabelBuilder().setLabel("Post in channel").setChannelSelectMenuComponent(channel),
        ),
    );
  } catch (error) {
    drafts.delete(token);
    throw error;
  }
}
async function publish(interaction: ButtonInteraction, token: string, draft: Draft) {
  if (draft.items.some(({ quantity }) => quantity === null))
    throw new Error("Set a quantity for every selected item before publishing.");
  draft.stage = "publishing";
  try {
    await interaction.deferUpdate();
    const guild = interaction.guild!;
    const channel = await guild.channels.fetch(draft.channelId);
    if (!channel || !channel.isSendable() || !CHANNEL_TYPES.some((type) => type === channel.type))
      throw new Error("Choose a sendable server text channel.");
    const sendPermission = channel.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages;
    const required = [PermissionFlagsBits.ViewChannel, sendPermission];
    const member = await guild.members.fetch(interaction.user.id);
    const bot = await guild.members.fetchMe();
    if (
      !channel.permissionsFor(member)?.has(required) ||
      !channel.permissionsFor(bot)?.has(required)
    )
      throw new Error(
        "Both you and the bot need permission to view and send messages in the selected channel.",
      );
    if (channel.isThread() && (channel.archived || channel.locked))
      throw new Error("Choose an active, unlocked thread.");
    const rewards = draft.items.map(({ item, quantity }) => {
      if (quantity === null)
        throw new Error("Set a quantity for every selected item before publishing.");
      return { item, quantity };
    });
    await channel.send({
      components: [renderCouponCard(draft.code, rewards)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    draft.stage = "ready";
    throw error;
  }
  drafts.delete(token);
  await dismissResponse(interaction);
}
export const createCouponComponentHandler: ComponentHandler = {
  matches: (customId) => customId.startsWith(PREFIX),
  async execute(interaction) {
    assertGuild(interaction);
    const [, , action, token] = interaction.customId.split(":");
    const draft = token ? drafts.get(token) : undefined;
    if (
      !draft ||
      draft.expires <= Date.now() ||
      draft.userId !== interaction.user.id ||
      draft.guildId !== interaction.guildId
    )
      throw new Error(
        "This coupon draft expired or belongs to another user. Run /sla create-coupon again.",
      );
    if (draft.stage === "publishing") throw new Error("This coupon is already being published.");
    if (interaction.isModalSubmit()) {
      if (action === "start" && draft.stage === "start") {
        const code = validateCode(interaction.fields.getTextInputValue("code"));
        const channel = interaction.fields
          .getSelectedChannels("channel", true, CHANNEL_TYPES)
          .first();
        if (!channel) throw new Error("Select a channel for the coupon.");
        draft.code = code;
        draft.channelId = channel.id;
        draft.stage = "ready";
        await interaction.reply({
          ...draftView(token!, draft),
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        return;
      }
      const match = /^quantity-([0-7])-(\d+)$/.exec(action ?? "");
      const form = draft.quantityForm;
      if (
        match &&
        draft.stage === "ready" &&
        form &&
        form.index === Number(match[1]) &&
        form.revision === Number(match[2])
      ) {
        const item = draft.items.find(({ index }) => index === form.index)!;
        const reward = parseCouponReward(
          item.item,
          interaction.fields.getTextInputValue("quantity"),
        )!;
        await interaction.deferUpdate();
        if (
          drafts.get(token!) !== draft ||
          draft.expires <= Date.now() ||
          draft.stage !== "ready" ||
          draft.quantityForm !== form
        )
          throw new Error("This quantity form is no longer available.");
        item.quantity = reward.quantity;
        draft.quantityForm = null;
        await interaction.editReply(draftView(token!, draft));
        return;
      }
    } else if (interaction.isButton()) {
      if (action === "cancel") {
        drafts.delete(token!);
        await interaction.deferUpdate();
        await dismissResponse(interaction);
        return;
      }
      if (action === "publish" && draft.stage === "ready") {
        await publish(interaction, token!, draft);
        return;
      }
      if (action === "page" && draft.stage === "ready" && draft.items.length > 4) {
        draft.page = draft.page === 0 ? 1 : 0;
        await interaction.update(draftView(token!, draft));
        return;
      }
      const match = /^quantity-([0-7])$/.exec(action ?? "");
      const item = match ? draft.items.find(({ index }) => index === Number(match[1])) : undefined;
      if (item && draft.stage === "ready") {
        const revision = ++draft.revision;
        const quantity = new TextInputBuilder()
          .setCustomId("quantity")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(1)
          .setMaxLength(16)
          .setPlaceholder("Positive whole number, e.g. 1000");
        if (item.quantity !== null) quantity.setValue(String(item.quantity));
        await interaction.showModal(
          new ModalBuilder()
            .setCustomId(`${PREFIX}quantity-${item.index}-${revision}:${token}`)
            .setTitle(`Item ${item.index + 1} quantity`)
            .addLabelComponents(
              new LabelBuilder()
                .setLabel("Quantity")
                .setDescription(itemLabels.get(item.item)!)
                .setTextInputComponent(quantity),
            ),
        );
        draft.quantityForm = { index: item.index, revision };
        return;
      }
    }
    throw new Error("This action is no longer available for this coupon draft.");
  },
};

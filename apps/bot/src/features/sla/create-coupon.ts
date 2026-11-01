import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  escapeMarkdown,
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
  time,
  TimestampStyles,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import type { ComponentHandler } from "@/core/command.ts";
import { couponItems, displayEmoji } from "@/shared/emojis/emoji-cache.ts";
import {
  CLAIM_BUTTON_PREFIX,
  claimCustomId,
  formatCouponDate,
  parseCouponAvailability,
  type CouponAvailability,
} from "./coupon-availability.ts";

import { getCouponProduct, type CouponProduct } from "./coupon.client.ts";

const itemEntries = Object.entries(couponItems).sort(([left], [right]) =>
  left.localeCompare(right, "en"),
);
const itemLabels = new Map<string, string>(
  itemEntries.map(([label, emojiName]) => [emojiName, label]),
);
const itemEmojis = new Map<string, EmojiName>(
  itemEntries.map(([, emojiName]) => [emojiName, emojiName]),
);
function validateItem(value: string) {
  const item = value.trim();
  if (!item || item.length > 100 || /[\r\n]/.test(item))
    throw new UserFacingError("Enter an item name of 1–100 characters without line breaks.");
  return item;
}
function rewardIcon(item: string) {
  return displayEmoji(itemEmojis.get(item) ?? "QuestionMark");
}
function rewardLabel(item: string) {
  return escapeMarkdown(itemLabels.get(item) ?? item);
}
export function normalizeCouponItem(value: string) {
  const item = validateItem(value);
  const key = (name: string) => name.toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ");
  return (
    itemEntries.find(([label, name]) => key(label) === key(item) || key(name) === key(item))?.[1] ??
    item
  );
}
type CouponItem = string;
export type CouponReward = { item: CouponItem; quantity: number };
const PREFIX = "sla:create-coupon:";
const DRAFT_TTL_MS = 300_000;
const COUPON_LOOKUP_PID = "B28D7AC7B5E34A6CA8B06ED800653165";
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
  itemForm: { index: number | null; revision: number } | null;
  nextItemIndex: number;
  availability: CouponAvailability;
  availabilityForm: number | null;
};
const drafts = new Map<string, Draft>();
function assertGuild(interaction: Actor): asserts interaction is Actor & { guildId: string } {
  if (!interaction.guild || !interaction.guildId)
    throw new UserFacingError("Create a coupon in a server channel.");
}
function validateCode(value: string) {
  const code = value.trim();
  if (!code || /[`\r\n]/.test(code))
    throw new UserFacingError("Enter a coupon code without backticks or line breaks.");
  if (`${CLAIM_BUTTON_PREFIX}${encodeURIComponent(code)}`.length > 100)
    throw new UserFacingError("Coupon code is too long. Enter a shorter code.");
  return code;
}
export function parseCouponReward(item: string | undefined, quantity: string): CouponReward | null {
  const value = quantity.trim();
  if (!item && !value) return null;
  if (!item || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new UserFacingError(
      "Choose an item and enter a positive whole-number quantity, or leave both fields empty.",
    );
  }
  return { item: validateItem(item), quantity: Number(value) };
}
function availabilityText({ startsAt, endsAt }: CouponAvailability) {
  return [
    startsAt === undefined
      ? ""
      : `🕒 **Available from:** ${time(startsAt, TimestampStyles.LongDateTime)}`,
    endsAt === undefined
      ? ""
      : `🕒 **Available until:** ${time(endsAt, TimestampStyles.LongDateTime)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
export function renderCouponCard(
  code: string,
  rewards: readonly CouponReward[],
  availability: CouponAvailability = {},
  product?: CouponProduct,
) {
  const validatedCode = validateCode(code);
  const card = new ContainerBuilder()
    .setAccentColor(0x411b4f)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# Claim coupon${product ? `\n## ${escapeMarkdown(product.productName)}` : ""}`,
          ),
          new TextDisplayBuilder().setContent(`\`\`\`\n${validatedCode}\n\`\`\``),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(
              product?.productImageUrl ??
                "https://cdn.discordapp.com/emojis/1556396384461262899.webp",
            )
            .setDescription("Coupon reward"),
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
                `**${rewardIcon(item)}${itemLabels.has(item) ? "" : ` ${rewardLabel(item)}`} x${Intl.NumberFormat("en-US").format(quantity)}**`,
            )
            .join("\n")}`,
        ),
      )
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true));
  }
  if (availability.startsAt !== undefined || availability.endsAt !== undefined) {
    card
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(availabilityText(availability)))
      .addSeparatorComponents(new SeparatorBuilder());
  }
  return card.addActionRowComponents(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(claimCustomId(validatedCode, availability))
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
  const dates = availabilityText(draft.availability);
  const editAvailability = button(token, "availability", "Edit availability", ButtonStyle.Primary);
  if (dates) {
    card.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(dates))
        .setButtonAccessory(editAvailability),
    );
  } else {
    card.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(editAvailability),
    );
  }
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
    for (const [offset, { index, item, quantity }] of draft.items
      .slice(draft.page * 4, draft.page * 4 + 4)
      .entries()) {
      card
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `**Item ${draft.page * 4 + offset + 1}** — ${rewardIcon(item)} ${rewardLabel(item)}${quantity === null ? " — Quantity required" : ` x${Intl.NumberFormat("en-US").format(quantity)}`}`,
          ),
        )
        .addActionRowComponents(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            button(token, `edit-item-${index}`, "Edit item", ButtonStyle.Primary),
            button(token, `quantity-${index}`, "Quantity"),
            button(token, `remove-item-${index}`, "Remove item", ButtonStyle.Danger),
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
    button(token, "add-item", "Add item", ButtonStyle.Primary).setDisabled(draft.items.length >= 8),
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
async function confirmCoupon(interaction: ButtonInteraction, content: string) {
  await editSuccessReply(interaction, {
    flags: MessageFlags.IsComponentsV2,
    components: [new TextDisplayBuilder().setContent(content)],
    allowedMentions: { parse: [] },
  });
}
export async function handleCreateCoupon(interaction: ChatInputCommandInteraction) {
  assertGuild(interaction);
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
    items: [],
    page: 0,
    stage: "start",
    revision: 0,
    quantityForm: null,
    itemForm: null,
    nextItemIndex: 0,
    availability: {},
    availabilityForm: null,
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
    throw new UserFacingError("Set a quantity for every selected item before publishing.");
  draft.stage = "publishing";
  try {
    await interaction.deferUpdate();
    const guild = interaction.guild!;
    const channel = await guild.channels.fetch(draft.channelId);
    if (!channel || !channel.isSendable() || !CHANNEL_TYPES.some((type) => type === channel.type))
      throw new UserFacingError("Choose a server channel where the bot can send messages.");
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
      throw new UserFacingError(
        "Both you and the bot need permission to view and send messages in the selected channel.",
      );
    if (channel.isThread() && (channel.archived || channel.locked))
      throw new UserFacingError("Choose an active, unlocked thread.");
    const rewards = draft.items.map(({ item, quantity }) => {
      if (quantity === null)
        throw new UserFacingError("Set a quantity for every selected item before publishing.");
      return { item, quantity };
    });
    if (draft.availability.endsAt !== undefined && draft.availability.endsAt <= Date.now() / 1000)
      throw new UserFacingError("The expiry date has passed. Edit availability before publishing.");
    const product = await getCouponProduct(draft.code, COUPON_LOOKUP_PID);
    await channel.send({
      components: [renderCouponCard(draft.code, rewards, draft.availability, product)],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    draft.stage = "ready";
    throw error;
  }
  drafts.delete(token);
  await confirmCoupon(interaction, `Coupon published in <#${draft.channelId}>.`);
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
      throw new UserFacingError(
        "This coupon draft expired or belongs to another user. Run /sla create-coupon again.",
      );
    if (draft.stage === "publishing")
      throw new UserFacingError("This coupon is already being published.");
    if (interaction.isModalSubmit()) {
      if (action === "start" && draft.stage === "start") {
        const code = validateCode(interaction.fields.getTextInputValue("code"));
        const channel = interaction.fields
          .getSelectedChannels("channel", true, CHANNEL_TYPES)
          .first();
        if (!channel) throw new UserFacingError("Select a channel for the coupon.");
        draft.code = code;
        draft.channelId = channel.id;
        draft.stage = "ready";
        await interaction.reply({
          ...draftView(token!, draft),
          flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
        return;
      }
      const availabilityMatch = /^availability-(\d+)$/.exec(action ?? "");
      if (
        availabilityMatch &&
        draft.stage === "ready" &&
        draft.availabilityForm === Number(availabilityMatch[1])
      ) {
        const revision = draft.availabilityForm;
        const availability = parseCouponAvailability(
          interaction.fields.getTextInputValue("starts-at"),
          interaction.fields.getTextInputValue("ends-at"),
        );
        claimCustomId(draft.code, availability);
        await interaction.deferUpdate();
        if (
          drafts.get(token!) !== draft ||
          draft.expires <= Date.now() ||
          draft.stage !== "ready" ||
          draft.availabilityForm !== revision
        )
          throw new UserFacingError("This form is unavailable. Run /sla create-coupon again.");
        draft.availability = availability;
        draft.availabilityForm = null;
        await interaction.editReply(draftView(token!, draft));
        return;
      }
      const itemMatch = /^item-(add|\d+)-(\d+)$/.exec(action ?? "");
      const itemForm = draft.itemForm;
      if (
        itemMatch &&
        draft.stage === "ready" &&
        itemForm &&
        itemForm.index === (itemMatch[1] === "add" ? null : Number(itemMatch[1])) &&
        itemForm.revision === Number(itemMatch[2])
      ) {
        const item = normalizeCouponItem(interaction.fields.getTextInputValue("item"));
        const quantity = interaction.fields.getTextInputValue("quantity").trim() || "1";
        const reward = parseCouponReward(item, quantity)!;
        const validateChange = () => {
          if (
            draft.items.some(
              (entry) =>
                entry.index !== itemForm.index && entry.item.toLowerCase() === item.toLowerCase(),
            )
          )
            throw new UserFacingError("Choose each coupon item only once.");
          if (itemForm.index === null && draft.items.length >= 8)
            throw new UserFacingError("A coupon can contain at most eight items.");
          if (
            itemForm.index !== null &&
            !draft.items.some((entry) => entry.index === itemForm.index)
          )
            throw new UserFacingError("This item was removed. Open a new item form.");
        };
        validateChange();
        await interaction.deferUpdate();
        if (
          drafts.get(token!) !== draft ||
          draft.expires <= Date.now() ||
          draft.stage !== "ready" ||
          draft.itemForm !== itemForm
        )
          throw new UserFacingError("This form is unavailable. Run /sla create-coupon again.");
        validateChange();
        if (itemForm.index === null) {
          draft.items.push({ index: draft.nextItemIndex++, ...reward });
          draft.page = Math.floor((draft.items.length - 1) / 4);
        } else {
          Object.assign(
            draft.items.find((entry) => entry.index === itemForm.index)!,
            reward,
          );
        }
        draft.itemForm = null;
        draft.quantityForm = null;
        await interaction.editReply(draftView(token!, draft));
        return;
      }
      const match = /^quantity-(\d+)-(\d+)$/.exec(action ?? "");
      const form = draft.quantityForm;
      if (
        match &&
        draft.stage === "ready" &&
        form &&
        form.index === Number(match[1]) &&
        form.revision === Number(match[2])
      ) {
        const item = draft.items.find(({ index }) => index === form.index);
        if (!item) throw new UserFacingError("This item was removed. Open a new quantity form.");
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
          throw new UserFacingError("This form is unavailable. Run /sla create-coupon again.");
        item.quantity = reward.quantity;
        draft.quantityForm = null;
        draft.itemForm = null;
        await interaction.editReply(draftView(token!, draft));
        return;
      }
    } else if (interaction.isButton()) {
      if (action === "cancel") {
        drafts.delete(token!);
        await interaction.deferUpdate();
        await confirmCoupon(interaction, "Coupon creation cancelled.");
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
      if (action === "availability" && draft.stage === "ready") {
        const revision = ++draft.revision;
        const field = (customId: string, label: string, value: number | undefined) => {
          const input = new TextInputBuilder()
            .setCustomId(customId)
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(200)
            .setPlaceholder("dd/MM/YYYY HH:mm or YYYY/MM/dd HH:mm");
          if (value !== undefined) input.setValue(formatCouponDate(value));
          return new LabelBuilder()
            .setLabel(label)
            .setDescription("UTC+0. Leave empty to remove this limit. Missing time means midnight.")
            .setTextInputComponent(input);
        };
        draft.availabilityForm = revision;
        try {
          await interaction.showModal(
            new ModalBuilder()
              .setCustomId(`${PREFIX}availability-${revision}:${token}`)
              .setTitle("Coupon availability (UTC+0)")
              .addLabelComponents(
                field("starts-at", "Available from", draft.availability.startsAt),
                field("ends-at", "Available until", draft.availability.endsAt),
              ),
          );
        } catch (error) {
          if (draft.availabilityForm === revision) draft.availabilityForm = null;
          throw error;
        }
        return;
      }
      const remove = /^remove-item-(\d+)$/.exec(action ?? "");
      if (remove && draft.stage === "ready") {
        const index = Number(remove[1]);
        if (!draft.items.some((entry) => entry.index === index))
          throw new UserFacingError("This item was already removed.");
        await interaction.deferUpdate();
        if (drafts.get(token!) !== draft || draft.expires <= Date.now() || draft.stage !== "ready")
          throw new UserFacingError("This draft is unavailable. Run /sla create-coupon again.");
        draft.items = draft.items.filter((entry) => entry.index !== index);
        draft.page = Math.min(draft.page, Math.max(0, Math.ceil(draft.items.length / 4) - 1));
        draft.itemForm = null;
        draft.quantityForm = null;
        await interaction.editReply(draftView(token!, draft));
        return;
      }
      const editItem = /^edit-item-(\d+)$/.exec(action ?? "");
      if ((action === "add-item" || editItem) && draft.stage === "ready") {
        const item = editItem
          ? draft.items.find((entry) => entry.index === Number(editItem[1]))
          : undefined;
        if (editItem && !item) throw new UserFacingError("This item was removed.");
        if (!editItem && draft.items.length >= 8)
          throw new UserFacingError("A coupon can contain at most eight items.");
        const form = { index: item?.index ?? null, revision: ++draft.revision };
        const nameInput = new TextInputBuilder()
          .setCustomId("item")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(100)
          .setPlaceholder("Catalog name (e.g. Gold) or a custom item name");
        if (item) nameInput.setValue(itemLabels.get(item.item) ?? item.item);
        const quantityInput = new TextInputBuilder()
          .setCustomId("quantity")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(16)
          .setValue(String(item?.quantity ?? 1));
        draft.itemForm = form;
        try {
          await interaction.showModal(
            new ModalBuilder()
              .setCustomId(`${PREFIX}item-${form.index ?? "add"}-${form.revision}:${token}`)
              .setTitle(item ? "Edit coupon item" : "Add coupon item")
              .addLabelComponents(
                new LabelBuilder().setLabel("Item name").setTextInputComponent(nameInput),
                new LabelBuilder()
                  .setLabel("Quantity")
                  .setDescription("Positive whole number; blank defaults to 1")
                  .setTextInputComponent(quantityInput),
              ),
          );
        } catch (error) {
          if (draft.itemForm === form) draft.itemForm = null;
          throw error;
        }
        return;
      }
      const match = /^quantity-(\d+)$/.exec(action ?? "");
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
        const form = { index: item.index, revision };
        draft.quantityForm = form;
        try {
          await interaction.showModal(
            new ModalBuilder()
              .setCustomId(`${PREFIX}quantity-${item.index}-${revision}:${token}`)
              .setTitle(`Item ${draft.items.indexOf(item) + 1} quantity`)
              .addLabelComponents(
                new LabelBuilder()
                  .setLabel("Quantity")
                  .setDescription(itemLabels.get(item.item) ?? item.item)
                  .setTextInputComponent(quantity),
              ),
          );
        } catch (error) {
          if (draft.quantityForm === form) draft.quantityForm = null;
          throw error;
        }
        return;
      }
    }
    throw new UserFacingError("This draft is unavailable. Run /sla create-coupon again.");
  },
};

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
export const COUPON_ITEMS = itemEntries.map(([, emojiName]) => emojiName);
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
type CouponItem = string;
export type CouponReward = { item: CouponItem; quantity: number };
const PREFIX = "sla:create-coupon:";
const DRAFT_TTL_MS = 300_000;
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
  pid: string;
  channelId: string;
  items: { index: number; item: CouponItem; quantity: number | null }[];
  page: number;
  stage: "start" | "ready" | "publishing";
  revision: number;
  quantityForm: { index: number; revision: number } | null;
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
    for (const { index, item, quantity } of draft.items.slice(draft.page * 4, draft.page * 4 + 4)) {
      card.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `**Item ${index + 1}** — ${rewardIcon(item)} ${rewardLabel(item)}${quantity === null ? " — Quantity required" : ` x${Intl.NumberFormat("en-US").format(quantity)}`}`,
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
async function confirmCoupon(interaction: ButtonInteraction, content: string) {
  await editSuccessReply(interaction, {
    flags: MessageFlags.IsComponentsV2,
    components: [new TextDisplayBuilder().setContent(content)],
    allowedMentions: { parse: [] },
  });
}
export async function handleCreateCoupon(interaction: ChatInputCommandInteraction) {
  assertGuild(interaction);
  const items: Draft["items"] = [];
  for (let index = 0; index < 8; index++) {
    const value = interaction.options.getString(`item_${index + 1}`);
    if (value === null) continue;
    const item = validateItem(value);
    if (items.some((selected) => selected.item === item))
      throw new UserFacingError("Choose each coupon item only once.");
    items.push({ index, item, quantity: 1 });
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
    pid: "",
    channelId: "",
    items,
    page: 0,
    stage: "start",
    revision: 0,
    quantityForm: null,
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
          new LabelBuilder()
            .setLabel("PID")
            .setDescription("Your player ID, used only to look up coupon details")
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId("pid")
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
    const product = await getCouponProduct(draft.code, draft.pid);
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
        const pid = interaction.fields.getTextInputValue("pid").trim();
        if (!pid) throw new UserFacingError("Enter your player ID (Member code).");
        const channel = interaction.fields
          .getSelectedChannels("channel", true, CHANNEL_TYPES)
          .first();
        if (!channel) throw new UserFacingError("Select a channel for the coupon.");
        draft.code = code;
        draft.pid = pid;
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
          throw new UserFacingError("This form is unavailable. Run /sla create-coupon again.");
        item.quantity = reward.quantity;
        draft.quantityForm = null;
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
                .setDescription(itemLabels.get(item.item) ?? item.item)
                .setTextInputComponent(quantity),
            ),
        );
        draft.quantityForm = { index: item.index, revision };
        return;
      }
    }
    throw new UserFacingError("This draft is unavailable. Run /sla create-coupon again.");
  },
};

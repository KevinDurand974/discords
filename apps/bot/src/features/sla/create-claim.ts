import {
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { CLAIM_BUTTON_PREFIX } from "./claim-components.ts";
import { displayEmoji, getEmojiByName } from "@/shared/emojis/emoji-cache.ts";

const ITEM_EMOJIS = [
  "Diamond",
  "Relic",
  "Mana_imbued_Fabric",
  "Rate_Up_Draw_Ticket",
  "Custom_Draw_Ticket",
  "Weapon_Custom_Draw_Ticket",
  "Essence_Stone",
] as const satisfies readonly EmojiName[];

export const itemChoices = ITEM_EMOJIS.map((item) => ({
  name: item,
  value: item,
}));

export const handleCreateClaim = async (interaction: ChatInputCommandInteraction) => {
  const couponCode = interaction.options.getString("code", true);
  const rewards = Array.from({ length: 4 }, (_, index) => {
    const position = index + 1;
    const item = interaction.options.getString(`item_${position}`);
    const quantity = interaction.options.getInteger(`quantity_${position}`);

    if (item === null && quantity === null) return null;
    if (item === null || quantity === null) {
      throw new Error(`Item ${position} requires both an item and a quantity`);
    }

    return { item, quantity };
  })
    .filter((reward): reward is { item: string; quantity: number } => reward !== null)
    .sort((a, b) => b.quantity - a.quantity)
    .map(
      ({ item, quantity }) =>
        `**${displayEmoji(item as EmojiName)} x${Intl.NumberFormat("en-US", { notation: "standard" }).format(quantity)}**`,
    );

  const customId = `${CLAIM_BUTTON_PREFIX}${encodeURIComponent(couponCode)}`;
  if (customId.length > 100) throw new Error("Coupon code is too long");

  const card = new ContainerBuilder()
    .setAccentColor(0x411b4f)
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `# Claim coupon${rewards.length > 0 ? `\n${rewards.join("\n")}` : ""}`,
          ),
        )
        .setThumbnailAccessory(
          new ThumbnailBuilder()
            .setURL(getEmojiByName("Chest_Classic").imageURL()!)
            .setDescription("Coupon reward"),
        ),
    )
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`\`\`\`${couponCode}\`\`\``))
        .setButtonAccessory(
          new ButtonBuilder().setCustomId(customId).setLabel("CLAIM").setStyle(ButtonStyle.Success),
        ),
    );

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.channel?.isSendable()) {
    throw new Error("This command can only be used in a sendable channel.");
  }

  await interaction.channel.send({
    components: [card],
    flags: MessageFlags.IsComponentsV2,
  });
  await interaction.deleteReply();
};

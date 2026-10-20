import {
  ContainerBuilder,
  escapeMarkdown,
  SectionBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { getCouponProduct, redeemCoupon } from "./coupon.client.ts";

const REDEEM_MODAL_ID = "sla:redeem";
const COUPON_INPUT_ID = "coupon";
const PID_INPUT_ID = "pid";

const createRedeemModal = () => {
  const couponInput = new TextInputBuilder()
    .setCustomId(COUPON_INPUT_ID)
    .setPlaceholder("Enter your coupon code")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);
  const pidInput = new TextInputBuilder()
    .setCustomId(PID_INPUT_ID)
    .setPlaceholder("Enter your PID (Member code)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(80);

  return new ModalBuilder()
    .setCustomId(REDEEM_MODAL_ID)
    .setTitle("Redeem a coupon")
    .addLabelComponents(
      new LabelBuilder().setLabel("Coupon code").setTextInputComponent(couponInput),
      new LabelBuilder()
        .setLabel("PID")
        .setDescription("Your player ID (Member code)")
        .setTextInputComponent(pidInput),
    );
};

const redeem = async (interaction: ModalSubmitInteraction, couponCode: string, pid: string) => {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const product = await getCouponProduct(couponCode, pid);
  const data = await redeemCoupon(couponCode, pid);

  if (data.errorCode === 24004) {
    throw new UserFacingError("This coupon has already been claimed.");
  }
  if (data.errorCode !== 200) {
    throw new UserFacingError(
      "Couldn't redeem the coupon. Check your coupon code and player ID, then try again.",
    );
  }

  await editSuccessReply(interaction, {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
    components: [
      new ContainerBuilder().addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
              `# Coupon redeemed.\n## ${escapeMarkdown(product.productName)}`,
            ),
          )
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(product.productImageUrl)),
      ),
    ],
  });
};

export const handleRedeem = async (interaction: ChatInputCommandInteraction) => {
  await interaction.showModal(createRedeemModal());
};

export const redeemComponentHandler: ComponentHandler = {
  matches: (customId) => customId === REDEEM_MODAL_ID,

  async execute(interaction) {
    if (!interaction.isModalSubmit()) return;

    const couponCode = interaction.fields.getTextInputValue(COUPON_INPUT_ID).trim();
    const pid = interaction.fields.getTextInputValue(PID_INPUT_ID).trim();

    await redeem(interaction, couponCode, pid);
  },
};

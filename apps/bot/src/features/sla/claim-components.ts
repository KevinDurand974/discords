import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { redeemCoupon } from "./coupon.client.ts";

export const CLAIM_BUTTON_PREFIX = "sla:claim:";
const CLAIM_MODAL_PREFIX = "sla:claim-modal:";
const PID_INPUT_ID = "pid";

const couponCodeFromCustomId = (customId: string, prefix: string) => {
  if (!customId.startsWith(prefix)) return null;

  try {
    return decodeURIComponent(customId.slice(prefix.length));
  } catch {
    return null;
  }
};

const showClaimModal = async (interaction: ButtonInteraction) => {
  const couponCode = couponCodeFromCustomId(interaction.customId, CLAIM_BUTTON_PREFIX);
  if (!couponCode) throw new Error("Invalid coupon button");

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(`${CLAIM_MODAL_PREFIX}${encodeURIComponent(couponCode)}`)
      .setTitle("Claim coupon")
      .addLabelComponents(
        new LabelBuilder()
          .setLabel("PID")
          .setDescription("Enter your player ID (Member code)")
          .setTextInputComponent(
            new TextInputBuilder()
              .setCustomId(PID_INPUT_ID)
              .setPlaceholder("Enter your PID (Member code)")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(80),
          ),
      ),
  );
};

const submitClaim = async (interaction: ModalSubmitInteraction) => {
  const couponCode = couponCodeFromCustomId(interaction.customId, CLAIM_MODAL_PREFIX);
  if (!couponCode) throw new Error("Invalid coupon form");

  const pid = interaction.fields.getTextInputValue(PID_INPUT_ID).trim();
  await interaction.deferReply({ ephemeral: true });

  const result = await redeemCoupon(couponCode, pid);
  if (result.errorCode !== 200) {
    await interaction.editReply(
      `Coupon claim failed (${result.errorCode}): ${result.errorMessage ?? "Unknown error"}`,
    );
    return;
  }

  await interaction.editReply("Coupon claimed successfully.");
};

export const claimComponentHandler: ComponentHandler = {
  matches: (customId) =>
    customId.startsWith(CLAIM_BUTTON_PREFIX) || customId.startsWith(CLAIM_MODAL_PREFIX),

  async execute(interaction) {
    if (interaction.isButton()) {
      await showClaimModal(interaction);
      return;
    }

    await submitClaim(interaction);
  },
};

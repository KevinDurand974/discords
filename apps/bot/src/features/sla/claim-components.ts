import {
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ComponentHandler } from "@/core/command.ts";
import { UserFacingError } from "@/core/errors.ts";
import { editSuccessReply } from "@/shared/interactions/success-reply.ts";
import { redeemCoupon } from "./coupon.client.ts";

import {
  assertCouponAvailable,
  claimCustomId,
  parseClaimCustomId,
  CLAIM_BUTTON_PREFIX,
  CLAIM_MODAL_PREFIX,
} from "./coupon-availability.ts";
export { CLAIM_BUTTON_PREFIX } from "./coupon-availability.ts";
const PID_INPUT_ID = "pid";

const showClaimModal = async (interaction: ButtonInteraction) => {
  const claim = parseClaimCustomId(interaction.customId, CLAIM_BUTTON_PREFIX);
  if (!claim) throw new UserFacingError("This coupon button is unavailable. Try /sla redeem.");
  assertCouponAvailable(claim.availability);

  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(claimCustomId(claim.code, claim.availability, true))
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
  const claim = parseClaimCustomId(interaction.customId, CLAIM_MODAL_PREFIX);
  if (!claim) throw new UserFacingError("This coupon form is unavailable. Try /sla redeem.");
  assertCouponAvailable(claim.availability);

  const pid = interaction.fields.getTextInputValue(PID_INPUT_ID).trim();
  await interaction.deferReply({ ephemeral: true });

  assertCouponAvailable(claim.availability);
  const result = await redeemCoupon(claim.code, pid);
  if (result.errorCode !== 200) {
    console.error("Coupon claim failed", { errorCode: result.errorCode });
    await interaction.editReply(
      result.errorCode === 24004
        ? "This coupon has already been claimed."
        : "Couldn't claim the coupon. Check your coupon code and player ID, then try again.",
    );
    return;
  }

  await editSuccessReply(interaction, "Coupon claimed.");
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

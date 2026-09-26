import { EmbedType, MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { redeemCoupon, type CouponSuccess } from "./coupon.client.ts";

export const handleRedeem = async (interaction: ChatInputCommandInteraction) => {
  const pid = interaction.options.getString("pid", true);
  const couponCode = interaction.options.getString("coupon", true);
  const data = await redeemCoupon(couponCode, pid);

  if (data.errorCode === 24004) {
    throw new Error("❌ Coupon already added to your account!");
  }
  if (data.errorCode !== 200) {
    throw new Error("❌ This coupon or PID doesn't exist!");
  }

  const successData = (data as CouponSuccess).resultData[0];
  if (!successData) {
    throw new Error("❌ An error occurred while creating success message");
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    embeds: [
      {
        title: "Coupon added!",
        description: successData.productName,
        thumbnail: { url: successData.productImageUrl },
        type: EmbedType.Rich,
      },
    ],
  });
};

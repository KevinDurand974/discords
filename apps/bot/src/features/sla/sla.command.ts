import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { handleRedeem } from "./redeem.ts";
import { handleCreateCoupon } from "./create-coupon.ts";
import {
  configureNewsGroup,
  handleNewsSetup,
} from "@/features/netmarble-news/news-setup-command.ts";

export const slaHelpDescription = [
  "redeem: Opens a required coupon-code and Personal ID (Member code) modal, then redeems the coupon. Treat your Personal ID as sensitive.",
  "create-coupon: Enter the coupon code and destination in a modal, then use Add item, Edit item, Quantity, and Remove item on the private draft to manage up to eight rewards. Enter a catalog item name or a custom name (QuestionMark icon). Quantities default to 1 and must be positive whole numbers. Duplicate rewards are rejected. Title and image lookup uses a fixed PID; no player ID is requested for creation. Claiming still requires your own Personal ID. Edit availability sets optional Available from and Expires at dates in UTC+0; empty fields remove the limits. Claim is allowed from the start date until, but not including, the expiry. Drafts expire after 10 minutes; both you and the bot need permission to post in the destination. Published coupons cannot be edited through the draft controls.",
  "news create: Creates/reactivates the news forum, with 0–10 backfilled articles (default 10). news backfill: Imports 1–50 historical articles (default 10). news status shows configuration; news disable stops future posts. News management needs Manage Channels; news clean permanently removes news resources after administrator confirmation.",
  "Examples: `/sla redeem` · `/sla create-coupon` · `/sla news backfill count:10`",
] as const;

export const slaCommand = {
  helpDescription: slaHelpDescription,
  data: new SlashCommandBuilder()
    .setName("sla")
    .setDescription("Solo Leveling: ARISE tools")
    .addSubcommandGroup(configureNewsGroup)
    .addSubcommand((subcommand) =>
      subcommand.setName("redeem").setDescription("Redeem a coupon code"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("create-coupon")
        .setDescription("Create a coupon with an interactive draft and optional rewards"),
    ),
  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === "news") {
      await handleNewsSetup(interaction);
      return;
    }
    switch (interaction.options.getSubcommand()) {
      case "redeem":
        return handleRedeem(interaction);
      case "create-coupon":
        return handleCreateCoupon(interaction);
    }
  },
} satisfies CommandDefinition;

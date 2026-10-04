import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { handleCreateClaim, itemChoices } from "./create-claim.ts";
import { handleRedeem } from "./redeem.ts";
import {
  configureNewsGroup,
  handleNewsSetup,
} from "@/features/netmarble-news/news-setup-command.ts";

export const slaCommand = {
  data: new SlashCommandBuilder()
    .setName("sla")
    .setDescription("Solo Leveling: ARISE tools")
    .addSubcommandGroup(configureNewsGroup)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("redeem")
        .setDescription("Redeem a coupon code")
        .addStringOption((option) =>
          option.setName("coupon").setDescription("Coupon code (optional)"),
        )
        .addStringOption((option) =>
          option.setName("pid").setDescription("Personal ID (Member code, optional)"),
        ),
    )
    .addSubcommand((subcommand) => {
      subcommand
        .setName("create")
        .setDescription("Create a coupon claim")
        .addStringOption((option) =>
          option.setName("code").setDescription("Coupon code").setRequired(true).setMaxLength(80),
        );

      return Array.from({ length: 4 }, (_, index) => index + 1).reduce(
        (builder, position) =>
          builder
            .addStringOption((option) =>
              option
                .setName(`item_${position}`)
                .setDescription(`Reward item ${position}`)
                .addChoices(itemChoices),
            )
            .addIntegerOption((option) =>
              option
                .setName(`quantity_${position}`)
                .setDescription(`Reward quantity ${position}`)
                .setMinValue(1),
            ),
        subcommand,
      );
    }),

  async execute(interaction) {
    if (interaction.options.getSubcommandGroup(false) === "news") {
      await handleNewsSetup(interaction);
      return;
    }
    switch (interaction.options.getSubcommand()) {
      case "redeem":
        return handleRedeem(interaction);
      case "create":
        return handleCreateClaim(interaction);
    }
  },
} satisfies CommandDefinition;

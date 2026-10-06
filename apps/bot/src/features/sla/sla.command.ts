import { SlashCommandBuilder } from "discord.js";
import type { CommandDefinition } from "@/core/command.ts";
import { handleRedeem } from "./redeem.ts";
import { autocompleteCouponItems, handleCreateCoupon } from "./create-coupon.ts";
import {
  configureNewsGroup,
  handleNewsSetup,
} from "@/features/netmarble-news/news-setup-command.ts";

export const slaHelpDescription = [
  "redeem: Opens a required coupon-code and Personal ID (Member code) modal, then redeems the coupon. Treat your Personal ID as sensitive.",
  "create-coupon: Select up to eight optional rewards via autocomplete, then enter the coupon code and destination in a modal. Set a positive whole-number quantity for each selected reward before publishing. Duplicate/unrecognized rewards are rejected. Drafts expire after 5 minutes; both you and the bot need permission to post in the destination.",
  "news create: Creates/reactivates the news forum, with 0–10 backfilled articles (default 10). news backfill: Imports 1–50 historical articles (default 10). news status shows configuration; news disable stops future posts. News management needs Manage Channels; news clean permanently removes news resources after administrator confirmation.",
  "Examples: `/sla redeem` · `/sla news backfill count:10`",
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
    .addSubcommand((subcommand) => {
      subcommand
        .setName("create-coupon")
        .setDescription("Create a coupon with an interactive form and optional rewards");
      return Array.from({ length: 8 }, (_, index) => index + 1).reduce(
        (builder, position) =>
          builder.addStringOption((option) =>
            option
              .setName(`item_${position}`)
              .setDescription(`Search for reward item ${position} (optional)`)
              .setAutocomplete(true),
          ),
        subcommand,
      );
    }),

  async autocomplete(interaction) {
    const startedAt = performance.now();
    // Approximate delivery age, based on the host's wall clock (requires clock synchronization).
    const interactionAgeMs = Date.now() - interaction.createdTimestamp;
    const focused = interaction.options.getFocused(true);
    if (
      interaction.options.getSubcommand() !== "create-coupon" ||
      !/^item_[1-8]$/.test(focused.name)
    ) {
      await interaction.respond([]);
      return;
    }
    const query = String(focused.value);
    const lookupStartedAt = performance.now();
    const excludedItems = Array.from({ length: 8 }, (_, index) => `item_${index + 1}`)
      .filter((name) => name !== focused.name)
      .flatMap((name) => {
        const selected = interaction.options.getString(name);
        return selected === null ? [] : [selected];
      });
    const choices = autocompleteCouponItems(query, excludedItems);
    const responseStartedAt = performance.now();
    let status: "success" | "error" = "error";
    try {
      await interaction.respond(choices);
      status = "success";
    } finally {
      const finishedAt = performance.now();
      const milliseconds = (value: number) => Math.round(value * 100) / 100;
      // TEMPORARY: remove after diagnosing autocomplete latency. Never log query text or user IDs.
      console.info("[DEBUG-coupon-autocomplete]", {
        interaction_age_ms_at_handler: interactionAgeMs,
        lookup_ms: milliseconds(responseStartedAt - lookupStartedAt),
        respond_ms: milliseconds(finishedAt - responseStartedAt),
        handler_ms: milliseconds(finishedAt - startedAt),
        ws_ping_ms: interaction.client.ws.ping,
        query_length: query.length,
        matches: choices.length,
        status,
      });
    }
  },

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

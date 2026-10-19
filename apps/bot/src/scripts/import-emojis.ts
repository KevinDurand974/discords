import { parseArgs } from "node:util";
import { REST } from "discord.js";
import { importEmojis } from "@/shared/emojis/emoji-transfer.ts";
import { emojiTransferCredentials } from "@/shared/emojis/emoji-transfer-credentials.ts";

try {
  const { values } = parseArgs({
    options: {
      directory: { type: "string", default: "data/emojis" },
      target: { type: "string", default: "dev" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.info(
      "Import application emojis without replacing existing names.\nUsage: nub run emojis:import [--target prod|dev] [--directory data/emojis] [--dry-run]\nDefaults to DEV (DISCORD_DEV_TOKEN / DISCORD_DEV_CLIENT_ID). PROD uses DISCORD_TOKEN / DISCORD_CLIENT_ID. Dry-run validates the archive without uploading.",
    );
  } else {
    const { ENV } = await import("@/core/config.ts");
    const { token, applicationId, target } = emojiTransferCredentials(ENV, values.target);
    console.info(
      `Emoji import destination: ${target} application ${applicationId}${values["dry-run"] ? " (dry-run)" : ""}.`,
    );
    const rest = new REST().setToken(token);
    const result = await importEmojis(rest, applicationId, values.directory, values["dry-run"]);
    console.info(
      `${result.created} created, ${result.skipped} existing name(s) skipped${result.dryRun ? `, ${result.planned} would be created` : ""}.`,
    );
  }
} catch (error) {
  console.error("Emoji import failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}

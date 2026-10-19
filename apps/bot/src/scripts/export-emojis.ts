import { parseArgs } from "node:util";
import { REST } from "discord.js";
import { exportEmojis } from "@/shared/emojis/emoji-transfer.ts";
import { emojiTransferCredentials } from "@/shared/emojis/emoji-transfer-credentials.ts";

try {
  const { values } = parseArgs({
    options: {
      directory: { type: "string", default: "data/emojis" },
      target: { type: "string", default: "prod" },
      format: { type: "string", default: "webp" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.info(
      "Export application emoji names and PNG/GIF or WebP images.\nUsage: nub run emojis:export [--target prod|dev] [--directory data/emojis] [--format png-gif|webp]\nDefaults to PROD (DISCORD_TOKEN / DISCORD_CLIENT_ID) and WebP. DEV uses DISCORD_DEV_TOKEN / DISCORD_DEV_CLIENT_ID. WebP preserves animations. The output directory must not already exist.",
    );
  } else {
    if (values.format !== "png-gif" && values.format !== "webp")
      throw new Error("--format must be png-gif or webp.");
    const { ENV } = await import("@/core/config.ts");
    const { token, applicationId, target } = emojiTransferCredentials(ENV, values.target);
    const rest = new REST().setToken(token);
    const result = await exportEmojis(
      rest,
      applicationId,
      values.directory,
      undefined,
      values.format,
    );
    console.info(
      `Exported ${result.exported} emoji(s) from ${target} application ${applicationId} to ${result.directory}.`,
    );
  }
} catch (error) {
  console.error("Emoji export failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
}

import { REST } from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { ENV, getDiscordCredentials } from "@/core/config.ts";
import { syncCommands } from "@/core/command-sync.ts";

const credentials = getDiscordCredentials();
const rest = new REST().setToken(credentials.token);

try {
  await syncCommands(
    rest,
    credentials.applicationId,
    commands.map((command) => command.data.toJSON()),
    ENV.DISCORD_GUILD_ID,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

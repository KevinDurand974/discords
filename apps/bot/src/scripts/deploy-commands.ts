import { REST } from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { ENV } from "@/core/config.ts";
import { syncCommands } from "@/core/command-sync.ts";

const rest = new REST().setToken(ENV.DISCORD_TOKEN);

try {
  await syncCommands(
    rest,
    ENV.DISCORD_CLIENT_ID,
    commands.map((command) => command.data.toJSON()),
    ENV.DISCORD_GUILD_ID,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

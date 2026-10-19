import { REST, Routes } from "discord.js";
import { ENV, getDiscordCredentials } from "@/core/config.ts";

const credentials = getDiscordCredentials();
const rest = new REST().setToken(credentials.token);

try {
  await rest.put(Routes.applicationCommands(credentials.applicationId), {
    body: [],
  });

  if (ENV.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(credentials.applicationId, ENV.DISCORD_GUILD_ID),
      { body: [] },
    );
  }

  console.log("Successfully deleted application commands.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

import { REST, Routes } from "discord.js";
import { ENV } from "@/core/config.ts";

const rest = new REST().setToken(ENV.DISCORD_TOKEN);

try {
  await rest.put(Routes.applicationCommands(ENV.DISCORD_CLIENT_ID), {
    body: [],
  });

  if (ENV.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(ENV.DISCORD_CLIENT_ID, ENV.DISCORD_GUILD_ID),
      { body: [] },
    );
  }

  console.log("Successfully deleted application commands.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

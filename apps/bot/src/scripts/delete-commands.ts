import { REST, Routes } from "discord.js";
import { ENV, getGuildId } from "@/core/config.ts";

const rest = new REST().setToken(ENV.DISCORD_TOKEN);

try {
  await rest.put(Routes.applicationGuildCommands(ENV.DISCORD_CLIENT_ID, getGuildId()), {
    body: [],
  });

  console.log("Successfully deleted application commands.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

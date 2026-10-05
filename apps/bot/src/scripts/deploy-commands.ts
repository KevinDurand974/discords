import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { ENV } from "@/core/config.ts";

const restCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = commands.map((command) =>
  command.data.toJSON(),
);
const rest = new REST().setToken(ENV.DISCORD_TOKEN);

try {
  console.log(`Refreshing ${restCommands.length} global command(s).`);

  const data = await rest.put(Routes.applicationCommands(ENV.DISCORD_CLIENT_ID), {
    body: restCommands,
  });

  if (ENV.DISCORD_GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(ENV.DISCORD_CLIENT_ID, ENV.DISCORD_GUILD_ID),
      { body: [] },
    );
    console.log("Successfully cleared legacy guild commands.");
  }

  console.log(`Successfully reloaded ${(data as unknown[]).length} application command(s).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

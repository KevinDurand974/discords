import { REST, Routes, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { ENV, getGuildId } from "@/core/config.ts";

const restCommands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = commands.map((command) =>
  command.data.toJSON(),
);
const rest = new REST().setToken(ENV.DISCORD_TOKEN);

try {
  console.log(`Refreshing ${restCommands.length} guild command(s).`);

  const data = await rest.put(
    Routes.applicationGuildCommands(ENV.DISCORD_CLIENT_ID, getGuildId()),
    { body: restCommands },
  );

  console.log(`Successfully reloaded ${(data as unknown[]).length} application command(s).`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}

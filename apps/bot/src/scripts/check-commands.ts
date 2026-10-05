import { REST, Routes, type RESTGetAPIApplicationCommandsResult } from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { ENV } from "@/core/config.ts";

const rest = new REST().setToken(ENV.DISCORD_TOKEN);
const summarize = (registered: RESTGetAPIApplicationCommandsResult) =>
  registered.map((command) => ({
    name: command.name,
    type: command.type,
    default_member_permissions: command.default_member_permissions,
    contexts: command.contexts,
    integration_types: command.integration_types,
    options: command.options?.map((option) => option.name),
  }));

try {
  const registered = (await rest.get(
    Routes.applicationCommands(ENV.DISCORD_CLIENT_ID),
  )) as RESTGetAPIApplicationCommandsResult;
  console.log("Global commands:", JSON.stringify(summarize(registered), null, 2));
  const missing = commands
    .filter((local) => !registered.some((remote) => remote.name === local.data.name))
    .map((command) => command.data.name);
  console.log("Missing global commands:", JSON.stringify(missing));
  if (missing.length) process.exitCode = 1;
  if (ENV.DISCORD_GUILD_ID) {
    const guildCommands = (await rest.get(
      Routes.applicationGuildCommands(ENV.DISCORD_CLIENT_ID, ENV.DISCORD_GUILD_ID),
    )) as RESTGetAPIApplicationCommandsResult;
    console.log("Guild commands:", JSON.stringify(summarize(guildCommands), null, 2));
    const application = await rest.get(Routes.oauth2CurrentApplication());
    const guild = await rest.get(Routes.guild(ENV.DISCORD_GUILD_ID));
    console.log("Application:", (application as { name: string }).name);
    console.log("Configured server:", (guild as { name: string }).name);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Unable to check registered commands.");
  process.exitCode = 1;
}

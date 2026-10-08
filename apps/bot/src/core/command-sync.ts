import { isDeepStrictEqual } from "node:util";
import {
  Routes,
  type REST,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

type CommandBody = RESTPostAPIChatInputApplicationCommandsJSONBody;
type SyncRest = Pick<REST, "get" | "put">;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function sorted(value: unknown, fallback: number[] = []) {
  return Array.isArray(value) ? [...value].sort() : fallback;
}

function option(value: unknown): Record<string, unknown> {
  const data = record(value);
  return {
    type: data.type,
    name: data.name,
    description: data.description,
    name_localizations: data.name_localizations ?? {},
    description_localizations: data.description_localizations ?? {},
    required: data.required ?? false,
    autocomplete: data.autocomplete ?? false,
    channel_types: sorted(data.channel_types),
    min_value: data.min_value ?? null,
    max_value: data.max_value ?? null,
    min_length: data.min_length ?? null,
    max_length: data.max_length ?? null,
    options: Array.isArray(data.options) ? data.options.map(option) : [],
    choices: Array.isArray(data.choices)
      ? data.choices.map((value) => {
          const choice = record(value);
          return {
            name: choice.name,
            value: choice.value,
            name_localizations: choice.name_localizations ?? {},
          };
        })
      : [],
  };
}

function command(value: unknown, integrationTypes: number[]) {
  const data = record(value);
  return {
    type: data.type ?? 1,
    name: data.name,
    description: data.description ?? "",
    name_localizations: data.name_localizations ?? {},
    description_localizations: data.description_localizations ?? {},
    default_member_permissions: data.default_member_permissions ?? null,
    nsfw: data.nsfw ?? false,
    contexts: sorted(data.contexts, data.dm_permission === false ? [0] : [0, 1, 2]),
    integration_types: sorted(data.integration_types, integrationTypes),
    options: Array.isArray(data.options) ? data.options.map(option) : [],
  };
}

export function commandDefinitionsEqual(
  local: readonly unknown[],
  remote: readonly unknown[],
  integrationTypes = [0],
) {
  const normalize = (values: readonly unknown[]) =>
    values
      .map((value) => command(value, integrationTypes))
      .sort((a, b) => `${a.type}:${a.name}`.localeCompare(`${b.type}:${b.name}`));
  return isDeepStrictEqual(normalize(local), normalize(remote));
}

export async function syncCommands(
  rest: SyncRest,
  applicationId: string,
  definitions: CommandBody[],
  guildId?: string,
) {
  const application = record(await rest.get(Routes.oauth2CurrentApplication()));
  const configuredTypes = Object.keys(record(application.integration_types_config)).map(Number);
  const integrationTypes = configuredTypes.length ? configuredTypes.sort() : [0];
  const route = Routes.applicationCommands(applicationId);
  const registered = await rest.get(route, {
    query: new URLSearchParams({ with_localizations: "true" }),
  });
  if (!Array.isArray(registered)) throw new Error("Discord returned an invalid command list");
  const changed = !commandDefinitionsEqual(definitions, registered, integrationTypes);
  if (changed) {
    await rest.put(route, { body: definitions });
    console.info(`Synchronized ${definitions.length} global command(s).`);
  } else {
    console.info("Global command definitions are unchanged; skipping synchronization.");
  }

  if (guildId) {
    const guildRoute = Routes.applicationGuildCommands(applicationId, guildId);
    const legacy = await rest.get(guildRoute);
    if (!Array.isArray(legacy)) throw new Error("Discord returned an invalid guild command list");
    if (legacy.length) {
      await rest.put(guildRoute, { body: [] });
      console.info("Cleared legacy guild commands.");
    }
  }
  return changed;
}

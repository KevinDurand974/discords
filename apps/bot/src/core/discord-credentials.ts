export type DiscordCredentialsEnv = {
  DISCORD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_DEV_TOKEN?: string;
  DISCORD_DEV_CLIENT_ID?: string;
};

/** Select credentials as a pair; a partially configured DEV bot must not fall back to PROD. */
export function resolveDiscordCredentials(
  env: DiscordCredentialsEnv,
  selection: "auto" | "prod" | "dev" = "auto",
) {
  const hasDev = Boolean(env.DISCORD_DEV_TOKEN?.trim() || env.DISCORD_DEV_CLIENT_ID?.trim());
  const target = selection === "auto" ? (hasDev ? "dev" : "prod") : selection;
  const tokenKey = target === "dev" ? "DISCORD_DEV_TOKEN" : "DISCORD_TOKEN";
  const idKey = target === "dev" ? "DISCORD_DEV_CLIENT_ID" : "DISCORD_CLIENT_ID";
  const token = env[tokenKey]?.trim();
  const applicationId = env[idKey]?.trim();
  if (!token) throw new Error(`${tokenKey} must be configured for the ${target} bot.`);
  if (!applicationId || !/^\d{17,20}$/.test(applicationId))
    throw new Error(`${idKey} must be a valid application ID for the ${target} bot.`);
  return { token, applicationId, target };
}

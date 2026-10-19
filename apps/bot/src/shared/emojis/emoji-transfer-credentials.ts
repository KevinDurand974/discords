type EmojiTransferEnv = {
  DISCORD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_DEV_TOKEN?: string;
  DISCORD_DEV_CLIENT_ID?: string;
};

export function emojiTransferCredentials(env: EmojiTransferEnv, target: string) {
  if (target !== "prod" && target !== "dev") throw new Error("--target must be prod or dev.");
  const tokenKey = target === "dev" ? "DISCORD_DEV_TOKEN" : "DISCORD_TOKEN";
  const idKey = target === "dev" ? "DISCORD_DEV_CLIENT_ID" : "DISCORD_CLIENT_ID";
  const token = env[tokenKey]?.trim();
  const applicationId = env[idKey]?.trim();
  if (!token) throw new Error(`${tokenKey} must be configured for --target ${target}.`);
  if (!applicationId || !/^\d{17,20}$/.test(applicationId))
    throw new Error(`${idKey} must be a valid application ID for --target ${target}.`);
  return { token, applicationId, target };
}

import {
  resolveDiscordCredentials,
  type DiscordCredentialsEnv,
} from "@/core/discord-credentials.ts";

export function emojiTransferCredentials(env: DiscordCredentialsEnv, target: string) {
  if (target !== "prod" && target !== "dev") throw new Error("--target must be prod or dev.");
  return resolveDiscordCredentials(env, target);
}

import "varlock/auto-load";
import { ENV } from "varlock/env";

export { ENV };

export const getGuildId = () => {
  if (!ENV.DISCORD_GUILD_ID) {
    throw new Error("DISCORD_GUILD_ID must be configured for guild commands.");
  }

  return ENV.DISCORD_GUILD_ID;
};

import type { CommandLogStore } from "./command-log-repository.ts";
import { DiscordAPIError, EmbedBuilder, type Client } from "discord.js";
import type { CommandLogger } from "./command.ts";

export const createCommandLogger = (client: Client, store: CommandLogStore): CommandLogger => {
  return {
    async setChannel(guildId, channelId) {
      await store.setChannel(guildId, channelId);
    },

    async log(entry) {
      let channelId: string | null = null;
      try {
        channelId = await store.getChannel(entry.guildId);
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId);
        if (!channel?.isSendable()) return;

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(entry.status === "success" ? 0x57f287 : 0xed4245)
              .setTitle("Command executed")
              .addFields(
                { name: "Command", value: entry.command },
                { name: "User", value: `${entry.userTag} (${entry.userId})` },
                { name: "Status", value: entry.status },
              )
              .setTimestamp(),
          ],
        });
      } catch (error) {
        if (channelId && error instanceof DiscordAPIError && error.code === 10003) {
          try {
            await store.clearChannel(entry.guildId, channelId);
            console.warn(
              `[Command logger] Log channel ${channelId} for server ${entry.guildId} no longer exists. Logging disabled for that destination; run /setup logs to configure a new channel.`,
            );
          } catch (cleanupError) {
            console.error("[Command logger] Failed to clear deleted log channel.", cleanupError);
          }
          return;
        }
        console.error("[Command logger] Failed to send command log.", error);
      }
    },
  };
};

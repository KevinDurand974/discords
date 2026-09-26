import { mkdir, readFile, writeFile } from "node:fs/promises";
import { EmbedBuilder, type Client } from "discord.js";
import type { CommandLogger } from "./command.ts";

const settingsPath = new URL("../../data/log-channels.json", import.meta.url);
const settingsDirectory = new URL("../../data/", import.meta.url);

type StoredLogChannels = Record<string, string>;

const loadLogChannels = async (): Promise<StoredLogChannels> => {
  try {
    const data: unknown = JSON.parse(await readFile(settingsPath, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};

    return Object.fromEntries(
      Object.entries(data).filter(
        ([guildId, channelId]) => typeof guildId === "string" && typeof channelId === "string",
      ),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    console.error("[Command logger] Failed to load log channel settings.", error);
    return {};
  }
};

export const createCommandLogger = async (client: Client): Promise<CommandLogger> => {
  const logChannels = new Map(Object.entries(await loadLogChannels()));
  let pendingWrite = Promise.resolve();

  const persist = () => {
    pendingWrite = pendingWrite.then(async () => {
      await mkdir(settingsDirectory, { recursive: true });
      await writeFile(
        settingsPath,
        `${JSON.stringify(Object.fromEntries(logChannels), null, 2)}\n`,
        "utf8",
      );
    });

    return pendingWrite;
  };

  return {
    async setChannel(guildId, channelId) {
      logChannels.set(guildId, channelId);
      await persist();
    },

    async log(entry) {
      const channelId = logChannels.get(entry.guildId);
      if (!channelId) return;

      try {
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
        console.error("[Command logger] Failed to send command log.", error);
      }
    },
  };
};

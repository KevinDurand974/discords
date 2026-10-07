import { DiscordAPIError, type TextChannel } from "discord.js";

export async function clearRuleChannel(channel: TextChannel, before?: string): Promise<void> {
  const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
  if (messages.size === 0) return;
  const oldestId = messages.last()!.id;
  await [...messages.values()].reduce(async (previous, message) => {
    await previous;
    try {
      await message.delete();
    } catch (error) {
      if (!(error instanceof DiscordAPIError && error.code === 10008)) throw error;
    }
  }, Promise.resolve());
  await clearRuleChannel(channel, oldestId);
}

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelFlags,
  ChannelType,
  type Client,
  type ForumChannel,
} from "discord.js";
import { splitDiscordText, toDiscordMarkdown } from "./discord-markdown.ts";
import { NEWS_TAGS, type NewsSetup } from "./news-setup.ts";
import type { NewsArticle } from "./news-api.ts";

export type NewsPublisher = {
  publish(setup: NewsSetup, article: NewsArticle, notify: boolean): Promise<string>;
  setPin(setup: NewsSetup, threadId: string, pinned: boolean): Promise<void>;
};

export function createNewsPublisher(client: Client): NewsPublisher {
  return {
    async publish(setup, article, notify) {
      const channel = await client.channels.fetch(setup.forumChannelId);
      if (channel?.type !== ChannelType.GuildForum || channel.guildId !== setup.guildId)
        throw new Error(`News Forum ${setup.forumChannelId} is missing or invalid.`);
      const forum: ForumChannel = channel;
      const mapping = setup.mappings.find(({ menuSeq }) => menuSeq === article.menuSeq);
      if (!mapping) throw new Error(`No Forum tag is configured for menu ${article.menuSeq}.`);
      const url = `https://forum.netmarble.com/slv_en/view/${article.menuSeq}/${article.id}`;
      const category = NEWS_TAGS.find(({ menuSeq }) => menuSeq === article.menuSeq)?.name ?? "News";
      const timestamp = Math.floor(new Date(article.createdAt).getTime() / 1000);
      if (!Number.isFinite(timestamp))
        throw new Error(`Invalid source date for article ${article.id}.`);
      const preview = `**${(article.title || `Article ${article.id}`).slice(0, 200)}**\n**${category}** · <t:${timestamp}:F>\n\n${(article.excerpt ?? "Read the full article below.").slice(0, 1000)}`;
      const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Read on Netmarble").setURL(url),
      );
      const thread = await forum.threads.create({
        name: article.title.slice(0, 100) || `Article ${article.id}`,
        appliedTags: [mapping.tagId],
        message: {
          content: notify ? `<@&${mapping.notificationRoleId}>\n${preview}` : preview,
          components: [button],
          allowedMentions: { parse: [], roles: notify ? [mapping.notificationRoleId] : [] },
        },
        reason: `Netmarble article ${article.id}`,
      });
      const details = splitDiscordText(toDiscordMarkdown(article.bodyHtml, article.excerpt));
      await details.reduce<Promise<void>>(async (previous, content) => {
        await previous;
        await thread.send({ content, allowedMentions: { parse: [] } });
      }, Promise.resolve());
      return thread.id;
    },
    async setPin(setup, threadId, pinned) {
      let channel;
      try {
        channel = await client.channels.fetch(threadId);
      } catch (error) {
        if (
          !pinned &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === 10003
        )
          return;
        throw error;
      }
      if (!channel && !pinned) return;
      if (
        !channel?.isThread() ||
        channel.type !== ChannelType.GuildPublicThread ||
        channel.guildId !== setup.guildId ||
        channel.parentId !== setup.forumChannelId
      )
        throw new Error(`News thread ${threadId} is missing or belongs to another Forum.`);
      if (channel.flags.has(ChannelFlags.Pinned) === pinned) return;
      if (pinned) await channel.pin("Pinned on Netmarble");
      else await channel.unpin("Unpinned on Netmarble");
    },
  };
}

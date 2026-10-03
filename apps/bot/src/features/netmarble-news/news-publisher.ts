import { decodeHTML } from "entities";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelFlags,
  ChannelType,
  ContainerBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ThumbnailBuilder,
  type AttachmentBuilder,
  type Client,
  type ForumChannel,
} from "discord.js";
import { renderArticleParts, splitDiscordText, type ArticlePart } from "./discord-markdown.ts";
import { type NewsSetup } from "./news-setup.ts";
import { importMedia } from "./media-importer.ts";
import type { NewsArticle } from "./news-api.ts";

function tableHeading(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/\\([\\`*_{}()#+.!>|~-]|\[|\])/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasTableText(value: string): boolean {
  return /[^\s\u200b]/u.test(value);
}

function tableContainers(
  part: Extract<ArticlePart, { type: "tableRow" }>,
  headers: string[],
  thumbnail?: AttachmentBuilder,
  fallback?: string,
): ContainerBuilder[] {
  const text = (content: string) => new TextDisplayBuilder().setContent(content);
  const values = part.columns.flatMap((column, index) => {
    const body =
      index === 1 && part.rightRows
        ? part.rightRows
            .filter(hasTableText)
            .map((row) => `- ${row}`)
            .join("\n")
        : column.trim();
    if (!hasTableText(body)) return [];
    return [headers[index] ? `-# ${headers[index]}\n${body}` : body];
  });
  if (fallback) values[0] = [values[0], fallback].filter(Boolean).join("\n");
  const chunks = values.flatMap((value) => splitDiscordText(value, 1500));
  return Array.from({ length: Math.ceil(chunks.length / 3) }, (_, containerIndex) => {
    const index = containerIndex * 3;
    const container = new ContainerBuilder();
    const first = chunks[index]!;
    if (index === 0 && thumbnail) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(first))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${thumbnail.name}`)),
      );
    } else container.addTextDisplayComponents(text(first));
    chunks.slice(index + 1, index + 3).forEach((chunk) => {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(text(chunk));
    });
    return container;
  });
}

function isUnknownChannel(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 10003;
}

function isUploadRejection(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    [40005, 50035].includes(Number(error.code))
  );
}

export type NewsPublisher = {
  publish(setup: NewsSetup, article: NewsArticle, notify: boolean): Promise<string>;
  /** Returns false if the Discord thread was deleted. */
  setPin(setup: NewsSetup, threadId: string, pinned: boolean): Promise<boolean>;
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
      const button = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Read on Netmarble").setURL(url),
      );
      const parts = renderArticleParts(article.bodyHtml, article.excerpt);
      const text = (content: string) => new TextDisplayBuilder().setContent(content);
      const create = (
        components: (TextDisplayBuilder | ActionRowBuilder<ButtonBuilder>)[],
        files?: AttachmentBuilder[],
        componentsV2 = true,
      ) =>
        forum.threads.create({
          name: decodeHTML(article.title).slice(0, 100) || `Article ${article.id}`,
          appliedTags: [mapping.tagId],
          message: {
            ...(componentsV2 ? { flags: MessageFlags.IsComponentsV2 } : {}),
            components: [...components, button],
            ...(files ? { files } : {}),
            allowedMentions: { parse: [] },
          },
          reason: `Netmarble article ${article.id}`,
        });
      let rowNumber = 0;
      let headers: string[] = [];
      const prepareRow = async (part: Extract<ArticlePart, { type: "tableRow" }>) => {
        rowNumber += 1;
        const imported = part.images[0]
          ? await importMedia(part.images[0], `media-${article.id}-row-${rowNumber}`, 10_000_000)
          : null;
        return imported;
      };
      const first = parts[0]!;
      let thread;
      if (first.type === "text") {
        thread = await create([text(first.content)]);
      } else if (first.type === "tableRow") {
        // Keep the source link in the starter; table rows follow in reading order.
        thread = await create([]);
      } else {
        const imported = await importMedia(first.url, `media-${article.id}-1`, 10_000_000);
        if (imported.attachment) {
          try {
            thread = await create([], [imported.attachment], false);
          } catch (error) {
            if (!isUploadRejection(error)) throw error;
            console.error(`Could not attach first image for news article ${article.id}`, error);
            thread = await create([text(imported.fallback)]);
          }
        } else thread = await create([text(imported.fallback)]);
      }
      await parts
        .slice(first.type === "tableRow" ? 0 : 1)
        .reduce<Promise<void>>(async (previous, part, index) => {
          await previous;
          if (part.type === "text") {
            headers = [];
            await thread.send({
              flags: MessageFlags.IsComponentsV2,
              components: [text(part.content)],
              allowedMentions: { parse: [] },
            });
            return;
          }
          if (part.type === "tableRow") {
            if (part.tableStart) headers = [];
            if (part.header) {
              headers = part.columns.map(tableHeading);
              return;
            }
            const imported = await prepareRow(part);
            const imageOnly = !part.columns.some(hasTableText);
            const sendRow = async (thumbnail?: AttachmentBuilder, fallback?: string) => {
              if (imageOnly) {
                if (thumbnail)
                  await thread.send({ files: [thumbnail], allowedMentions: { parse: [] } });
                else if (fallback)
                  await thread.send({ content: fallback, allowedMentions: { parse: [] } });
                return;
              }
              await tableContainers(part, headers, thumbnail, fallback).reduce<Promise<void>>(
                async (previous, container, index) => {
                  await previous;
                  await thread.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [container],
                    ...(index === 0 && thumbnail ? { files: [thumbnail] } : {}),
                    allowedMentions: { parse: [] },
                  });
                },
                Promise.resolve(),
              );
            };
            if (imported?.attachment) {
              try {
                await sendRow(imported.attachment);
              } catch (error) {
                if (!isUploadRejection(error)) throw error;
                await sendRow(undefined, imported.fallback);
              }
            } else await sendRow(undefined, imported?.fallback);
            await part.images
              .slice(1)
              .reduce<Promise<void>>(async (previousImage, imageUrl, imageIndex) => {
                await previousImage;
                const extra = await importMedia(
                  imageUrl,
                  `media-${article.id}-row-${rowNumber}-${imageIndex + 2}`,
                  10_000_000,
                );
                if (extra.attachment) {
                  try {
                    await thread.send({
                      files: [extra.attachment],
                      allowedMentions: { parse: [] },
                    });
                    return;
                  } catch (error) {
                    if (!isUploadRejection(error)) throw error;
                  }
                }
                await thread.send({
                  flags: MessageFlags.IsComponentsV2,
                  components: [text(extra.fallback)],
                  allowedMentions: { parse: [] },
                });
              }, Promise.resolve());
            return;
          }
          headers = [];
          const imported = await importMedia(
            part.url,
            `media-${article.id}-${index + (first.type === "tableRow" ? 1 : 2)}`,
            10_000_000,
          );
          if (imported.attachment) {
            try {
              await thread.send({
                files: [imported.attachment],
                allowedMentions: { parse: [] },
              });
              return;
            } catch (error) {
              if (!isUploadRejection(error)) throw error;
              console.error(`Could not attach image for news article ${article.id}`, error);
            }
          }
          await thread.send({
            flags: MessageFlags.IsComponentsV2,
            components: [text(imported.fallback)],
            allowedMentions: { parse: [] },
          });
        }, Promise.resolve());
      await thread.send({
        content: `<@&${mapping.notificationRoleId}>`,
        allowedMentions: { parse: [], roles: notify ? [mapping.notificationRoleId] : [] },
      });
      return thread.id;
    },
    async setPin(setup, threadId, pinned) {
      let channel;
      try {
        channel = await client.channels.fetch(threadId);
      } catch (error) {
        if (isUnknownChannel(error)) return false;
        throw error;
      }
      if (!channel) return false;
      if (
        !channel?.isThread() ||
        channel.type !== ChannelType.GuildPublicThread ||
        channel.guildId !== setup.guildId ||
        channel.parentId !== setup.forumChannelId
      )
        throw new Error(`News thread ${threadId} is missing or belongs to another Forum.`);
      if (channel.flags.has(ChannelFlags.Pinned) === pinned) return true;
      try {
        if (pinned) await channel.pin("Pinned on Netmarble");
        else await channel.unpin("Unpinned on Netmarble");
      } catch (error) {
        if (isUnknownChannel(error)) return false;
        throw error;
      }
      return true;
    },
  };
}

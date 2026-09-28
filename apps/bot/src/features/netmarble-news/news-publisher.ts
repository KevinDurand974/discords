import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelFlags,
  ChannelType,
  ContainerBuilder,
  MediaGalleryBuilder,
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

function tableContainers(
  part: Extract<ArticlePart, { type: "tableRow" }>,
  headers: string[],
  thumbnail?: AttachmentBuilder,
  fallback?: string,
): ContainerBuilder[] {
  const text = (content: string) => new TextDisplayBuilder().setContent(content);
  const values = part.columns.map((column, index) => {
    const body =
      index === 1 && part.rightRows
        ? part.rightRows.map((row) => `- ${row || "\u200b"}`).join("\n")
        : column || "\u200b";
    return `-# ${headers[index] || (index === 0 ? "Category" : "Changed")}\n${body}`;
  });
  if (values.length === 1) values.push(`-# ${headers[1] || "Changed"}\n\u200b`);
  if (fallback) values[0] = `${values[0] || ""}\n${fallback}`;
  const chunks = values.flatMap((value) => splitDiscordText(value, 1500));
  const containers: ContainerBuilder[] = [];
  for (let index = 0; index < chunks.length; index += 3) {
    const container = new ContainerBuilder();
    const first = chunks[index]!;
    if (index === 0 && thumbnail) {
      container.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(first))
          .setThumbnailAccessory(new ThumbnailBuilder().setURL(`attachment://${thumbnail.name}`)),
      );
    } else container.addTextDisplayComponents(text(first));
    for (const chunk of chunks.slice(index + 1, index + 3)) {
      container.addSeparatorComponents(new SeparatorBuilder());
      container.addTextDisplayComponents(text(chunk));
    }
    containers.push(container);
  }
  return containers;
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
      const mention = notify ? `<@&${mapping.notificationRoleId}>\n` : "";
      const text = (content: string) => new TextDisplayBuilder().setContent(content);
      const gallery = (file: AttachmentBuilder) =>
        new MediaGalleryBuilder().addItems({ media: { url: `attachment://${file.name}` } });
      const create = (
        components: (TextDisplayBuilder | MediaGalleryBuilder | ActionRowBuilder<ButtonBuilder>)[],
        files?: AttachmentBuilder[],
      ) =>
        forum.threads.create({
          name: article.title.slice(0, 100) || `Article ${article.id}`,
          appliedTags: [mapping.tagId],
          message: {
            flags: MessageFlags.IsComponentsV2,
            components: [...components, button],
            ...(files ? { files } : {}),
            allowedMentions: { parse: [], roles: notify ? [mapping.notificationRoleId] : [] },
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
        thread = await create([text(`${mention}${first.content}`)]);
      } else if (first.type === "tableRow") {
        // Forum starters need a message; the table's own V2 container follows it.
        thread = await create(mention ? [text(mention.trim())] : []);
      } else {
        const imported = await importMedia(first.url, `media-${article.id}-1`, 10_000_000);
        const prefix = mention ? [text(mention.trim())] : [];
        if (imported.attachment) {
          try {
            thread = await create([...prefix, gallery(imported.attachment)], [imported.attachment]);
          } catch (error) {
            if (!isUploadRejection(error)) throw error;
            console.error(`Could not attach first image for news article ${article.id}`, error);
            thread = await create([text(`${mention}${imported.fallback}`)]);
          }
        } else thread = await create([text(`${mention}${imported.fallback}`)]);
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
            if (part.header) {
              headers = part.columns.map(tableHeading);
              return;
            }
            const imported = await prepareRow(part);
            const sendRow = async (thumbnail?: AttachmentBuilder, fallback?: string) => {
              for (const [index, container] of tableContainers(
                part,
                headers,
                thumbnail,
                fallback,
              ).entries())
                await thread.send({
                  flags: MessageFlags.IsComponentsV2,
                  components: [container],
                  ...(index === 0 && thumbnail ? { files: [thumbnail] } : {}),
                  allowedMentions: { parse: [] },
                });
            };
            if (imported?.attachment) {
              try {
                await sendRow(imported.attachment);
              } catch (error) {
                if (!isUploadRejection(error)) throw error;
                await sendRow(undefined, imported.fallback);
              }
            } else await sendRow(undefined, imported?.fallback);
            for (const [imageIndex, imageUrl] of part.images.slice(1).entries()) {
              const extra = await importMedia(
                imageUrl,
                `media-${article.id}-row-${rowNumber}-${imageIndex + 2}`,
                10_000_000,
              );
              if (extra.attachment) {
                try {
                  await thread.send({
                    flags: MessageFlags.IsComponentsV2,
                    components: [gallery(extra.attachment)],
                    files: [extra.attachment],
                    allowedMentions: { parse: [] },
                  });
                  continue;
                } catch (error) {
                  if (!isUploadRejection(error)) throw error;
                }
              }
              await thread.send({
                flags: MessageFlags.IsComponentsV2,
                components: [text(extra.fallback)],
                allowedMentions: { parse: [] },
              });
            }
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
                flags: MessageFlags.IsComponentsV2,
                components: [gallery(imported.attachment)],
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

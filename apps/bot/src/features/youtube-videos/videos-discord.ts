import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ContainerBuilder,
  ForumLayoutType,
  SortOrderType,
  MessageFlags,
  PermissionFlagsBits as P,
  SeparatorBuilder,
  TextDisplayBuilder,
  type Client,
  type ForumChannel,
  type Guild,
  type ThreadChannel,
} from "discord.js";
import type { ForumSettings, Intent, Video } from "./videos-repository.ts";

const required = [
  P.ViewChannel,
  P.ManageChannels,
  P.ManageRoles,
  P.ManageThreads,
  P.SendMessages,
  P.SendMessagesInThreads,
  P.ReadMessageHistory,
  P.EmbedLinks,
];
const marker = (videoId: string, part: number) =>
  `YouTube source: yt:video:${videoId} · part ${part}`;
export function videoForumPermissions(guildId: string, botId: string, moderatorIds: string[]) {
  return [
    {
      id: guildId,
      allow: [P.ViewChannel, P.ReadMessageHistory],
      deny: [P.SendMessages, P.SendMessagesInThreads],
    },
    ...moderatorIds
      .filter((id) => id !== guildId)
      .map((id) => ({ id, allow: [P.SendMessages], deny: [P.SendMessagesInThreads] })),
    // Manage Roles stays on the guild role: only administrators can overwrite it in a channel.
    { id: botId, allow: required.filter((permission) => permission !== P.ManageRoles) },
  ];
}
function descriptionChunks(description: string, videoUrl: string) {
  // Match existing links/URLs first so their timestamps and fragments stay untouched.
  const tokens = description.matchAll(
    /\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/[^\s<>]+|(?<![\p{L}\p{N}_:/])\d+:[0-5]\d(?![\p{L}\p{N}_:])|(?<![\p{L}\p{N}_/#])#[\p{L}\p{M}\p{N}_]+|[\s\S]/gu,
  );
  const chunks = [""];
  const append = (text: string) => {
    const last = chunks.length - 1;
    if (chunks[last]!.length + text.length > 2800) chunks.push(text);
    else chunks[last] += text;
  };
  for (const [token] of tokens) {
    let text = token;
    if (/^\d+:[0-5]\d$/.test(token)) {
      const [minutes, seconds] = token.split(":").map(Number);
      const total = minutes! * 60 + seconds!;
      if (Number.isSafeInteger(total)) {
        const url = new URL(videoUrl);
        url.searchParams.set("t", `${total}s`);
        text = `[${token}](${url.href})`;
      }
    } else if (/^#[\p{L}\p{M}\p{N}_]+$/u.test(token)) {
      text = `[${token}](https://www.youtube.com/hashtag/${encodeURIComponent(token.slice(1))})`;
    }
    // Keep generated Markdown links atomic; preserve oversized original text as Unicode chunks.
    if (text.length > 2800) Array.from(token).forEach(append);
    else append(text);
  }
  return chunks;
}
export function renderVideo(video: Video) {
  const chunks = descriptionChunks(video.description || "No description available.", video.url);
  return chunks.map((description, index) => ({
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as [] },
    components: [
      new ContainerBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`## ${video.title.slice(0, 400)}`),
        )
        .addSeparatorComponents(new SeparatorBuilder())
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(description))
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            `<t:${Math.floor(video.publishedAt.getTime() / 1000)}:f>`,
          ),
        )
        .addActionRowComponents(
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setStyle(ButtonStyle.Link)
              .setLabel("Watch on YouTube")
              .setURL(video.url),
          ),
        )
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(`-# ${marker(video.videoId, index + 1)}`),
        ),
    ],
  }));
}
const missing = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === 10003;
export async function getVideoForum(guild: Guild, id: string | null): Promise<ForumChannel | null> {
  if (!id) return null;
  try {
    const channel = await guild.channels.fetch(id);
    if (!channel) return null;
    if (channel.type !== ChannelType.GuildForum)
      throw new Error("Saved video channel is not a Forum; refusing to modify it.");
    return channel;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}
export async function provisionVideoForum(guild: Guild) {
  const bot = await guild.members.fetchMe();
  if (!bot.permissions.has(required))
    throw new Error(
      "The bot needs View Channel, Manage Channels, Manage Roles (overwrites), Manage Threads, Send Messages, Send Messages in Threads, Read Message History and Embed Links.",
    );
  await guild.roles.fetch();
  const moderators = guild.roles.cache
    .filter(
      (role) => role.permissions.has(P.ManageMessages) && !role.permissions.has(P.Administrator),
    )
    .map((role) => role.id);
  return guild.channels.create({
    name: "Latest Videos",
    type: ChannelType.GuildForum,
    defaultForumLayout: ForumLayoutType.ListView,
    defaultSortOrder: SortOrderType.CreationDate,
    topic:
      "Game guide videos from tracked YouTube creators. Moderators may create posts; comments are disabled. Videos, Shorts and livestreams are accepted.",
    permissionOverwrites: videoForumPermissions(guild.id, bot.id, moderators),
    reason: "YouTube Latest Videos setup",
  });
}
export async function checkVideoPermissions(forum: ForumChannel) {
  const bot = await forum.guild.members.fetchMe();
  if (!forum.permissionsFor(bot)?.has(required))
    throw new Error("The bot is missing required permissions in Latest Videos.");
  return bot;
}
export async function auditVideoPermissions(forum: ForumChannel) {
  const bot = await checkVideoPermissions(forum);
  await forum.guild.roles.fetch();
  // Rebuild only the feature-owned Forum policy; unrelated channels/roles remain untouched.
  const moderators = forum.guild.roles.cache
    .filter(
      (role) => role.permissions.has(P.ManageMessages) && !role.permissions.has(P.Administrator),
    )
    .map((role) => role.id);
  await forum.permissionOverwrites.set(videoForumPermissions(forum.guildId, bot.id, moderators));
  // A moderator role with Manage Threads could unlock/alter threads, but cannot ordinarily comment without SendMessagesInThreads.
}
export async function creatorTag(
  forum: ForumChannel,
  displayName: string,
  channelId: string,
  savedTagId: string | null,
  boundTags: string[],
) {
  const saved = savedTagId ? forum.availableTags.find((tag) => tag.id === savedTagId) : undefined;
  const base = Array.from(displayName.trim()).slice(0, 20).join("") || channelId.slice(0, 20);
  if (saved) {
    const name = forum.availableTags.some((tag) => tag.id !== saved.id && tag.name === base)
      ? `${Array.from(base).slice(0, 10).join("")} ${channelId.slice(-9)}`
      : base;
    if (forum.availableTags.some((tag) => tag.id !== saved.id && tag.name === name))
      throw new Error("Creator tag rename collides with another tag.");
    if (saved.name !== name)
      await forum.setAvailableTags(
        forum.availableTags.map((tag) => (tag.id === saved.id ? { ...tag, name } : tag)),
      );
    return { id: saved.id, owned: true };
  }
  const compatible = forum.availableTags.find(
    (tag) => tag.name === base && !boundTags.includes(tag.id),
  );
  if (compatible) return { id: compatible.id, owned: false };
  if (forum.availableTags.length >= 20)
    throw new Error("Latest Videos has reached its 20 creator-tag limit.");
  const name = forum.availableTags.some((tag) => tag.name === base)
    ? `${Array.from(base).slice(0, 10).join("")} ${channelId.slice(-9)}`
    : base;
  if (forum.availableTags.some((tag) => tag.name === name))
    throw new Error("Creator tag name collision; rename the conflicting tag before retrying.");
  await forum.setAvailableTags([...forum.availableTags, { name }]);
  const created = forum.availableTags.find((tag) => tag.name === name);
  if (!created) throw new Error("Discord did not return the creator tag.");
  return { id: created.id, owned: true };
}

async function messages(thread: ThreadChannel) {
  const collect = async (
    before?: string,
    pages = 0,
  ): Promise<{ content: string; components: string }[]> => {
    if (pages >= 50)
      throw new Error("Too many messages to reconcile safely; manual inspection is required.");
    const page = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    const own = page
      .filter((message) => message.author.id === thread.client.user?.id)
      .map((message) => ({
        content: message.content ?? "",
        components: JSON.stringify(message.components.map((component) => component.toJSON())),
      }));
    return page.size < 100 ? own : [...own, ...(await collect(page.last()!.id, pages + 1))];
  };
  return collect();
}
async function forumThreads(forum: ForumChannel) {
  const active = await forum.threads.fetchActive();
  const archived = async (before?: Date, pages = 0): Promise<ThreadChannel[]> => {
    if (pages >= 20)
      throw new Error(
        "Archived thread scan limit reached; publication needs manual reconciliation.",
      );
    const page = await forum.threads.fetchArchived({ limit: 100, ...(before ? { before } : {}) });
    const rows = [...page.threads.values()];
    if (!page.hasMore) return rows;
    const last = rows.at(-1)?.archiveTimestamp;
    if (!last) throw new Error("Cannot paginate archived threads safely.");
    return [...rows, ...(await archived(new Date(last), pages + 1))];
  };
  return [
    ...new Map(
      [...active.threads.values(), ...(await archived())].map((thread) => [thread.id, thread]),
    ).values(),
  ];
}
export async function deleteVideoPosts(
  forum: ForumChannel,
  tagId?: string,
  knownThreadIds = new Set<string>(),
) {
  // Enumerate first: hitting a pagination limit must not leave a partially deleted page.
  const candidates = await forumThreads(forum);
  let deleted = 0;
  for (const thread of candidates) {
    const known = knownThreadIds.has(thread.id);
    if (tagId && !known && !thread.appliedTags.includes(tagId)) continue;
    const starter = await thread.fetchStarterMessage();
    if (known && starter && starter.author.id !== forum.client.user?.id)
      throw new Error("Saved video thread ownership changed; refusing to delete it.");
    if (
      !known &&
      (starter?.author.id !== forum.client.user?.id ||
        !/"content":"-# YouTube source: yt:video:[A-Za-z0-9_-]{11} · part 1"/.test(
          JSON.stringify(starter.components),
        ))
    )
      continue;
    await thread.delete("Administrator-confirmed YouTube video cleanup");
    deleted += 1;
  }
  return deleted;
}
async function findThread(forum: ForumChannel, video: Video) {
  // The bot-authored starter marker is authoritative, not the visible title.
  // Scan all posts so title changes and legacy ID-suffixed names still reconcile.
  const candidates = await forumThreads(forum);
  const verified = (
    await Promise.all(
      candidates.map(async (thread) => {
        const starter = await thread.fetchStarterMessage();
        return starter?.author.id === forum.client.user?.id &&
          JSON.stringify(starter.components).includes(
            JSON.stringify(`-# ${marker(video.videoId, 1)}`),
          )
          ? thread
          : null;
      }),
    )
  ).filter((thread): thread is ThreadChannel => thread !== null);
  if (verified.length > 1)
    throw new Error("Multiple matching video posts found; manual reconciliation is required.");
  return verified[0];
}
export async function publishVideo(
  client: Client,
  setup: ForumSettings,
  intent: Intent,
  video: Video,
  tagId: string,
  checkpoint: (threadId: string) => Promise<void>,
) {
  const guild = await client.guilds.fetch(setup.guildId);
  const forum = await getVideoForum(guild, setup.forumChannelId);
  if (!forum || !forum.availableTags.some((tag) => tag.id === tagId))
    throw new Error("Video Forum/tag is missing; run /youtube setup or /youtube add to repair it.");
  const parts = renderVideo(video);
  let thread: ThreadChannel | undefined;
  if (intent.threadId) {
    const fetched = await guild.channels.fetch(intent.threadId);
    if (!fetched?.isThread() || fetched.parentId !== forum.id)
      throw new Error("Known video thread is missing/invalid; manual repair is required.");
    thread = fetched;
  } else if (intent.state !== "pending") {
    thread = await findThread(forum, video);
  }
  if (!thread) {
    thread = await forum.threads.create({
      name: video.title.slice(0, 100),
      appliedTags: [tagId],
      message: parts[0]!,
      reason: `YouTube source ${video.videoId}`,
    });
  }
  await checkpoint(thread.id);
  if (thread.archived) await thread.setArchived(false);
  const existing = await messages(thread);
  await parts.slice(1).reduce(async (previous, part, index) => {
    await previous;
    if (
      !existing.some(({ components }) =>
        components.includes(JSON.stringify(`-# ${marker(video.videoId, index + 2)}`)),
      )
    )
      await thread!.send(part);
  }, Promise.resolve());
  // V2 messages cannot unfurl native embeds, even for URLs outside the Container.
  // Send a separate classic message last; reconcile it by bot author + exact URL on retry.
  if (!existing.some(({ content }) => content === video.url)) {
    await thread.send({ content: video.url, allowedMentions: { parse: [] } });
  }
  return thread.id;
}

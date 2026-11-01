import {
  ChannelFlagsBitField,
  ContainerBuilder,
  MessageFlags,
  TextDisplayBuilder,
  escapeMarkdown,
  type ForumChannel,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";
import { contentLabel } from "./content-filter.ts";
import type { ForumSettings, VideosRepository } from "./videos-repository.ts";

type TrackedCreator = Awaited<ReturnType<VideosRepository["subscriptions"]>>[number];

export function renderCreatorList(tracked: TrackedCreator[]) {
  const entries = tracked
    .filter(({ subscription }) => subscription.enabled)
    .map(({ creator, subscription }) => ({
      content: contentLabel(subscription.contentMode),
      id: creator.channelId,
      name: creator.displayName.replace(/\s+/g, " ").slice(0, 80),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map(
      ({ id, name, content }) =>
        `- [${escapeMarkdown(name)}](https://www.youtube.com/channel/${id}) — ${content}`,
    );
  const content = `## Followed YouTube creators\n\n${entries.join("\n") || "No creators are currently followed."}`;
  if (content.length > 4000)
    throw new UserFacingError("The creator list is too long to publish in one post.");
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    allowedMentions: { parse: [] as [] },
    components: [
      new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(content)),
    ],
  };
}

const isMissing = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === 10003 || error.code === 10008);

async function savedCreatorList(forum: ForumChannel, threadId: string | null) {
  if (!threadId) return null;
  try {
    const thread = await forum.guild.channels.fetch(threadId, { force: true });
    if (!thread) return null;
    if (!thread.isThread() || thread.parentId !== forum.id)
      throw new Error("Saved creator list is outside the configured YouTube Forum.");
    const starter = await thread.fetchStarterMessage().catch((error: unknown) => {
      if (typeof error === "object" && error !== null && "code" in error && error.code === 10008)
        return null;
      throw error;
    });
    if ((starter?.author.id ?? thread.ownerId) !== forum.client.user?.id)
      throw new Error("Saved creator list is not owned by the bot.");
    return { thread, starter };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function updateCreatorList(
  forum: ForumChannel,
  setup: ForumSettings,
  store: VideosRepository,
  pinned = setup.creatorListPinned,
) {
  const payload = renderCreatorList(await store.subscriptions(setup.guildId));
  const saved = await savedCreatorList(forum, setup.creatorListThreadId);
  let thread = saved?.thread;
  if (saved) {
    if (!saved.starter)
      throw new UserFacingError(
        "The creator list's first message is missing. Delete its Forum post, then run /youtube list.",
      );
    if (saved.thread.archived) await saved.thread.setArchived(false);
    await saved.starter.edit(payload);
  } else {
    if (forum.flags.has(ChannelFlagsBitField.Flags.RequireTag) && !forum.availableTags.length)
      throw new UserFacingError("This Forum requires a tag. Create a Forum tag, then try again.");
    thread = await forum.threads.create({
      name: "Followed YouTube creators",
      message: payload,
      ...(forum.flags.has(ChannelFlagsBitField.Flags.RequireTag)
        ? { appliedTags: [forum.availableTags[0]!.id] }
        : {}),
      reason: "YouTube creator list",
    });
    try {
      await store.setCreatorList(setup.guildId, thread.id, pinned);
    } catch (error) {
      try {
        await thread.delete("YouTube creator list could not be saved");
      } catch (cleanupError) {
        console.error("Orphaned YouTube creator list", { threadId: thread.id, cleanupError });
      }
      throw error;
    }
  }
  if (thread!.flags.has(ChannelFlagsBitField.Flags.Pinned) !== pinned) {
    if (pinned) await thread!.pin("YouTube creator list pin preference");
    else await thread!.unpin("YouTube creator list pin preference");
  }
  await store.setCreatorList(setup.guildId, thread!.id, pinned);
  return thread!;
}

export async function deleteCreatorList(forum: ForumChannel, setup: ForumSettings) {
  const saved = await savedCreatorList(forum, setup.creatorListThreadId);
  if (saved) await saved.thread.delete("Administrator-confirmed YouTube cleanup");
}

import { describe, expect, it, vi } from "vitest";
import {
  ComponentType,
  MessageFlags,
  PermissionFlagsBits as P,
  type ForumChannel,
} from "discord.js";
import { creatorTag, renderVideo, videoForumPermissions } from "./videos-discord.ts";
import type { Video } from "./videos-repository.ts";
const video: Video = {
  videoId: "abcdefghijk",
  channelId: `UC${"a".repeat(22)}`,
  sourceEntryId: "yt:video:abcdefghijk",
  title: "Game guide",
  description: "A guide @everyone",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  publishedAt: new Date("2026-10-01"),
  sourceUpdatedAt: null,
  firstSeenAt: new Date(),
  lastSeenAt: new Date(),
};
function forumWithTags(tags: { id: string; name: string }[]) {
  const state = {
    availableTags: tags,
    setAvailableTags: vi.fn(async (next: { id?: string; name: string }[]) => {
      state.availableTags = next.map((tag, index) => ({
        id: tag.id ?? `new-${index}`,
        name: tag.name,
      }));
    }),
  };
  return { state, forum: state as unknown as ForumChannel };
}
describe("video presentation and resources", () => {
  it("renders title, separator, description, publication date and link button without mentions", () => {
    const [message] = renderVideo(video);
    expect(message!.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message!.allowedMentions.parse).toEqual([]);
    const components = message!.components[0]!.toJSON().components;
    expect(components.map((component) => component.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
      ComponentType.TextDisplay,
      ComponentType.ActionRow,
      ComponentType.TextDisplay,
    ]);
    expect(components[0]).toMatchObject({ content: `## ${video.title}` });
    expect(components[2]).toMatchObject({ content: video.description });
    expect(components[3]).toMatchObject({
      content: `<t:${Math.floor(video.publishedAt.getTime() / 1000)}:f>`,
    });
    expect(components[4]).toMatchObject({
      components: [{ label: "Watch on YouTube", url: video.url }],
    });
    expect(
      components.filter((component) => component.type === ComponentType.TextDisplay),
    ).not.toContainEqual(expect.objectContaining({ content: video.url }));
    expect(JSON.stringify(components)).toContain("Watch on YouTube");
    expect(JSON.stringify(components)).toContain("yt:video:abcdefghijk");
  });
  it("preserves full long Unicode descriptions within the aggregate text limit", () => {
    const description = "🦁é\n".repeat(3000);
    const messages = renderVideo({ ...video, description });
    expect(messages.length).toBeGreaterThan(1);
    const chunks = messages.map((message) => {
      const texts = message.components[0]!.toJSON().components.filter(
        (component) => component.type === ComponentType.TextDisplay,
      );
      expect(texts.reduce((sum, text) => sum + text.content.length, 0)).toBeLessThanOrEqual(4000);
      return texts[1]!.content;
    });
    expect(chunks.join("")).toBe(description);
    expect(JSON.stringify(messages.map((message) => message.components[0]!.toJSON()))).not.toMatch(
      /\\ud[89ab][0-9a-f]{2}/i,
    );
  });
  it("links timestamps to the video with a seconds query parameter", () => {
    const [message] = renderVideo({
      ...video,
      url: `${video.url}&t=10s#chapter`,
      description: "00:00 Intro\n03:42 Guide\n120:05 End",
    });
    expect(message!.components[0]!.toJSON().components[2]).toMatchObject({
      content:
        `[00:00](${video.url}&t=0s#chapter) Intro\n` +
        `[03:42](${video.url}&t=222s#chapter) Guide\n` +
        `[120:05](${video.url}&t=7205s#chapter) End`,
    });
  });
  it("links hashtags without including the hash in the URL and encodes Unicode tags", () => {
    const [message] = renderVideo({ ...video, description: "#Game_2026, #été! #ゲーム" });
    expect(message!.components[0]!.toJSON().components[2]).toMatchObject({
      content:
        "[#Game_2026](https://www.youtube.com/hashtag/Game_2026), " +
        `[#été](https://www.youtube.com/hashtag/${encodeURIComponent("été")})! ` +
        `[#ゲーム](https://www.youtube.com/hashtag/${encodeURIComponent("ゲーム")})`,
    });
  });
  it("leaves URLs, existing Markdown links, invalid times and embedded tokens untouched", () => {
    const description =
      "https://example.com/03:42#tag [03:42 #tag](https://example.com) " +
      "03:60 01:02:03 word03:42 word#tag ##heading";
    const [message] = renderVideo({ ...video, description });
    expect(message!.components[0]!.toJSON().components[2]).toMatchObject({ content: description });
  });
  it("keeps generated links intact at message boundaries and respects text limits", () => {
    const description = `${"x".repeat(2795)} 03:42 #guide `.repeat(3);
    const messages = renderVideo({ ...video, description });
    const chunks = messages.map((message) => {
      const texts = message.components[0]!.toJSON().components.filter(
        (component) => component.type === ComponentType.TextDisplay,
      );
      expect(texts.reduce((sum, text) => sum + text.content.length, 0)).toBeLessThanOrEqual(4000);
      return texts[1]!.content;
    });
    const timestamp = `[03:42](${video.url}&t=222s)`;
    const hashtag = "[#guide](https://www.youtube.com/hashtag/guide)";
    expect(chunks.join("")).toBe(`${"x".repeat(2795)} ${timestamp} ${hashtag} `.repeat(3));
    expect(chunks.filter((chunk) => chunk.includes(timestamp))).toHaveLength(3);
    expect(chunks.filter((chunk) => chunk.includes(hashtag))).toHaveLength(3);
  });
  it("has a readable fallback for empty descriptions", () => {
    expect(
      JSON.stringify(renderVideo({ ...video, description: "" })[0]!.components[0]!.toJSON()),
    ).toContain("No description available.");
  });
  it("allows moderator post creation but denies human comments and gives the bot access", () => {
    const permissions = videoForumPermissions("guild", "bot", ["moderator"]);
    expect(permissions[0]!.deny).toContain(P.SendMessagesInThreads);
    expect(permissions[1]!.allow).toEqual([P.SendMessages]);
    expect(permissions[1]!.deny).toContain(P.SendMessagesInThreads);
    expect(permissions.at(-1)!.allow).toContain(P.SendMessagesInThreads);
    expect(permissions.at(-1)!.allow).toContain(P.EmbedLinks);
  });
  it("reuses a saved creator tag even at capacity", async () => {
    const { forum, state } = forumWithTags(
      Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: i ? `Creator ${i}` : "Creator" })),
    );
    expect(await creatorTag(forum, "Creator", video.channelId, "0", ["0"])).toEqual({
      id: "0",
      owned: true,
    });
    expect(state.setAvailableTags).not.toHaveBeenCalled();
  });
  it("reuses an unbound matching creator tag without claiming ownership", async () => {
    const { forum } = forumWithTags([{ id: "tag", name: "Creator" }]);
    expect(await creatorTag(forum, "Creator", video.channelId, null, [])).toEqual({
      id: "tag",
      owned: false,
    });
  });
  it("does not merge distinct channel IDs sharing a display name", async () => {
    const { forum, state } = forumWithTags([{ id: "tag", name: "Creator" }]);
    const tag = await creatorTag(forum, "Creator", video.channelId, null, ["tag"]);
    expect(tag.id).not.toBe("tag");
    expect(state.availableTags.map((tag) => tag.name)).toEqual([
      "Creator",
      `Creator ${video.channelId.slice(-9)}`,
    ]);
  });
  it("rejects capacity overflow before modifying tags", async () => {
    const { forum, state } = forumWithTags(
      Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `Creator ${i}` })),
    );
    await expect(creatorTag(forum, "New creator", video.channelId, null, [])).rejects.toThrow(
      "20 creator-tag limit",
    );
    expect(state.setAvailableTags).not.toHaveBeenCalled();
  });
  it("renames a creator's tag in place", async () => {
    const { forum, state } = forumWithTags([{ id: "tag", name: "Old name" }]);
    expect((await creatorTag(forum, "New name", video.channelId, "tag", ["tag"])).id).toBe("tag");
    expect(state.availableTags).toEqual([{ id: "tag", name: "New name" }]);
  });
});

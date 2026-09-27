import { describe, expect, it, vi } from "vitest";
import { ButtonStyle, ChannelType, type Client } from "discord.js";
import { createNewsPublisher } from "./news-publisher.ts";
import type { NewsArticle } from "./news-api.ts";
import type { NewsSetup } from "./news-setup.ts";

const article: NewsArticle = {
  id: 109472,
  menuSeq: 32,
  title: "Server update",
  excerpt: "Details here",
  bodyHtml: "<p>Full <strong>details</strong>.</p>",
  canonicalUrl: "https://not-trusted.example/",
  createdAt: "2026-09-26T12:00:00.000Z",
  isSourcePinned: false,
};
const setup: NewsSetup = {
  guildId: "guild",
  forumChannelId: "forum",
  enabled: true,
  initialImportMode: "backfill",
  initialBackfillCount: 10,
  initialImportCompleted: true,
  mappings: [{ menuSeq: 32, tagId: "tag", notificationRoleId: "role" }],
};

function fixture() {
  const send = vi.fn(async () => ({}));
  const pin = vi.fn(async () => ({}));
  const create = vi.fn(
    async (_options: {
      appliedTags: string[];
      message: {
        content: string;
        allowedMentions: unknown;
        components: { components: { data: unknown }[] }[];
      };
    }) => ({ id: "thread", send, pin }),
  );
  const client = {
    channels: {
      fetch: vi.fn(async () => ({
        type: ChannelType.GuildForum,
        guildId: "guild",
        threads: { create },
      })),
    },
  } as unknown as Client;
  return { publisher: createNewsPublisher(client), create, send, pin };
}

describe("Forum publishing", () => {
  it("uses the tag, full detail, one canonical link button, and only the live role", async () => {
    const f = fixture();
    expect(await f.publisher.publish(setup, article, true, false)).toBe("thread");
    const options = f.create.mock.calls[0]![0];
    expect(options.appliedTags).toEqual(["tag"]);
    expect(options.message.content).toContain("<@&role>\n**Server update**");
    expect(options.message.content).toContain("Details here");
    expect(options.message).not.toHaveProperty("embeds");
    expect(options.message.allowedMentions).toEqual({ parse: [], roles: ["role"] });
    const buttonRow = options.message.components.at(0);
    expect(buttonRow?.components).toHaveLength(1);
    expect(buttonRow?.components.at(0)?.data).toMatchObject({
      style: ButtonStyle.Link,
      url: "https://forum.netmarble.com/slv_en/view/32/109472",
    });
    expect(f.send).toHaveBeenCalledWith({
      content: "Full **details**.",
      allowedMentions: { parse: [] },
    });
  });

  it("does not ping on historical posts and pins initial source-pinned imports", async () => {
    const f = fixture();
    await f.publisher.publish(setup, { ...article, isSourcePinned: true }, false, true);
    expect(f.create.mock.calls[0]![0].message.content).toContain("**Server update**");
    expect(f.create.mock.calls[0]![0].message.content).not.toContain("<@&role>");
    expect(f.create.mock.calls[0]![0].message.allowedMentions).toEqual({ parse: [], roles: [] });
    expect(f.pin).toHaveBeenCalledOnce();
    expect(f.create.mock.calls[0]![0].message).not.toHaveProperty("embeds");
  });
});

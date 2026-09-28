import { describe, expect, it, vi } from "vitest";
import { ButtonStyle, ChannelType, MessageFlags, type Client } from "discord.js";
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
  const send = vi.fn(
    async (_options: {
      content?: string;
      flags?: number;
      components?: { data?: { content?: string }; toJSON?: () => unknown }[];
      files?: unknown[];
      embeds?: unknown[];
      allowedMentions: unknown;
    }) => ({}),
  );
  const pin = vi.fn(async () => ({}));
  const unpin = vi.fn(async () => ({}));
  const thread = {
    id: "thread",
    type: ChannelType.GuildPublicThread,
    guildId: "guild",
    parentId: "forum",
    isThread: () => true,
    flags: { has: vi.fn(() => false) },
    send,
    pin,
    unpin,
  };
  const create = vi.fn(
    async (_options: {
      appliedTags: string[];
      message: {
        content?: string;
        flags?: number;
        files?: unknown[];
        embeds?: unknown[];
        allowedMentions: unknown;
        components: {
          data?: { content?: string };
          components?: { data: unknown }[];
          toJSON?: () => unknown;
        }[];
      };
    }) => thread,
  );
  const client = {
    channels: {
      fetch: vi.fn(async (id: string) =>
        id === "missing"
          ? null
          : id === "forum"
            ? { type: ChannelType.GuildForum, guildId: "guild", threads: { create } }
            : thread,
      ),
    },
  } as unknown as Client;
  return {
    publisher: createNewsPublisher(client),
    fetchChannel: client.channels.fetch as ReturnType<typeof vi.fn>,
    create,
    send,
    pin,
    unpin,
    thread,
  };
}

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const mockImageFetch = () =>
  vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () => new Response(png, { headers: { "content-type": "image/png" } }),
    );

describe("Forum publishing", () => {
  it("starts with article text, its canonical button and only the live role (no preview)", async () => {
    const f = fixture();
    expect(await f.publisher.publish(setup, article, true)).toBe("thread");
    const options = f.create.mock.calls[0]![0];
    expect(options.appliedTags).toEqual(["tag"]);
    expect(options.message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(options.message.content).toBeUndefined();
    expect(options.message.components[0]).toMatchObject({
      data: { content: "<@&role>\nFull **details**." },
    });
    expect(options.message).not.toHaveProperty("embeds");
    expect(options.message.allowedMentions).toEqual({ parse: [], roles: ["role"] });
    expect(options.message.components[1]?.components?.[0]?.data).toMatchObject({
      style: ButtonStyle.Link,
      url: "https://forum.netmarble.com/slv_en/view/32/109472",
    });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("preserves HTML text/image order with V2 galleries and ignores unpositioned thumbnails", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    try {
      await f.publisher.publish(
        setup,
        {
          ...article,
          thumbnailUrl: "https://forum.netmarble.com/thumbnail.png",
          bodyHtml:
            '<p>Before</p><img src="https://forum.netmarble.com/first.png"><p>Between</p><img src="https://forum.netmarble.com/second.png"><p>After</p>',
          media: [
            {
              position: 0,
              originalUrl: "https://forum.netmarble.com/second.png",
              mediaType: null,
              filename: null,
            },
          ],
        },
        false,
      );
      expect(f.create.mock.calls[0]![0].message.components[0]).toMatchObject({
        data: { content: "Before" },
      });
      expect(
        f.send.mock.calls.map(([options]) => [
          options.components?.[0]?.data?.content,
          options.files?.[0],
        ]),
      ).toMatchObject([
        [undefined, { name: "media-109472-2.png" }],
        ["Between", undefined],
        [undefined, { name: "media-109472-4.png" }],
        ["After", undefined],
      ]);
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("uses V2 text, galleries and table containers", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    try {
      await f.publisher.publish(
        setup,
        {
          ...article,
          bodyHtml:
            '<p>Before</p><img src="https://forum.netmarble.com/a.png"><table><tr><td>A</td><td>B</td></tr></table><p>After</p>',
        },
        false,
      );
      const opening = f.create.mock.calls[0]![0].message;
      expect(opening.flags).toBe(MessageFlags.IsComponentsV2);
      expect(opening).not.toHaveProperty("embeds");
      expect(f.send.mock.calls[0]![0]).toMatchObject({ flags: MessageFlags.IsComponentsV2 });
      expect(f.send.mock.calls[0]![0].components?.[0]?.toJSON?.()).toMatchObject({
        items: [{ media: { url: "attachment://media-109472-2.png" } }],
      });
      expect(f.send.mock.calls[1]![0].embeds).toBeUndefined();
      expect(f.send.mock.calls[1]![0].flags).toBe(MessageFlags.IsComponentsV2);
      expect(f.send.mock.calls[1]![0].components?.[0]?.toJSON?.()).toMatchObject({
        components: [{ content: "-# Category\nA" }, { type: 14 }, { content: "-# Changed\nB" }],
      });
      expect(f.send.mock.calls[2]![0]).toMatchObject({ flags: MessageFlags.IsComponentsV2 });
    } finally {
      fetcher.mockRestore();
    }
  });

  it("puts table headers inside the row sections instead of publishing a header row", async () => {
    const f = fixture();
    await f.publisher.publish(
      setup,
      {
        ...article,
        bodyHtml:
          "<table><tr><th><strong>Stat</strong></th><th><code>Value</code></th></tr><tr><td>ATK</td><td><del>100</del> 120</td></tr></table><p>After</p>",
      },
      false,
    );
    expect(f.create.mock.calls[0]![0].message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[0]![0].components?.[0]?.toJSON?.()).toMatchObject({
      components: [{ content: "-# Stat\nATK" }, { type: 14 }, { content: "-# Value\n~~100~~ 120" }],
    });
    expect(f.send.mock.calls[1]![0].components?.[0]?.data?.content).toBe("After");
  });

  it("renders the right-hand rows of a rowspan as bullets in one container", async () => {
    const f = fixture();
    await f.publisher.publish(
      setup,
      {
        ...article,
        bodyHtml:
          '<table><tr><td rowspan="3">Shared</td><td>One</td></tr><tr><td>Two</td></tr><tr><td>Three</td></tr></table>',
      },
      false,
    );
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]![0].components?.[0]?.toJSON?.()).toMatchObject({
      components: [
        { content: "-# Category\nShared" },
        { type: 14 },
        { content: "-# Changed\n- One\n- Two\n- Three" },
      ],
    });
  });

  it("uses source reward headers and bullets for a shared left-hand period", async () => {
    const f = fixture();
    await f.publisher.publish(
      setup,
      {
        ...article,
        bodyHtml:
          '<table><tr><td>Reward Claim Period (UTC+0)</td><td>Reward Details</td></tr><tr><td rowspan="2">After maintenance</td><td>Essence Stones x500</td></tr><tr><td>Dungeon Keys x10</td></tr></table>',
      },
      false,
    );
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send.mock.calls[0]![0].components?.[0]?.toJSON?.()).toMatchObject({
      components: [
        { content: "-# Reward Claim Period (UTC+0)\nAfter maintenance" },
        { type: 14 },
        { content: "-# Reward Details\n- Essence Stones x500\n- Dungeon Keys x10" },
      ],
    });
  });

  it("places table-cell images in a section thumbnail", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    try {
      await f.publisher.publish(
        setup,
        {
          ...article,
          bodyHtml:
            '<p>Before</p><table><tr><td>Prize</td><td><img src="https://forum.netmarble.com/prize.png">Rare</td></tr></table><p>After</p>',
        },
        false,
      );
      const row = f.send.mock.calls[0]![0];
      expect(row.components?.[0]?.toJSON?.()).toMatchObject({
        components: [
          { accessory: { media: { url: "attachment://media-109472-row-1.png" } } },
          { type: 14 },
          { content: "-# Changed\nRare" },
        ],
      });
      expect(row.files).toMatchObject([{ name: "media-109472-row-1.png" }]);
      expect(row.embeds).toBeUndefined();
      expect(f.send.mock.calls[1]![0].components?.[0]?.data?.content).toBe("After");
      expect(fetcher).toHaveBeenCalledOnce();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("starts an image-table post with a V2 link followed by its thumbnail container", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    try {
      await f.publisher.publish(
        setup,
        {
          ...article,
          bodyHtml:
            '<table><tr><td>Prize</td><td><img src="https://forum.netmarble.com/prize.png"></td></tr></table>',
        },
        false,
      );
      const opening = f.create.mock.calls[0]![0].message;
      expect(opening.flags).toBe(MessageFlags.IsComponentsV2);
      expect(opening.embeds).toBeUndefined();
      expect(f.send.mock.calls[0]![0].components?.[0]?.toJSON?.()).toMatchObject({
        components: [
          { accessory: { media: { url: "attachment://media-109472-row-1.png" } } },
          { type: 14 },
          { content: "-# Changed\n\u200b" },
        ],
      });
      expect(f.send.mock.calls[0]![0].files).toMatchObject([{ name: "media-109472-row-1.png" }]);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("falls back to the image URL inside the container on rejected upload", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    try {
      f.send.mockRejectedValueOnce(Object.assign(new Error("invalid upload"), { code: 50035 }));
      await f.publisher.publish(
        setup,
        {
          ...article,
          bodyHtml:
            '<p>Before</p><table><tr><td><img src="https://forum.netmarble.com/prize.png"></td></tr></table>',
        },
        false,
      );
      expect(f.send).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(f.send.mock.calls[1]![0].components?.[0]?.toJSON?.())).toContain(
        "https://forum.netmarble.com/prize.png",
      );
      expect(f.send.mock.calls[1]![0].files).toBeUndefined();
    } finally {
      fetcher.mockRestore();
    }
  });

  it("splits oversized table rows across V2 containers", async () => {
    const f = fixture();
    await f.publisher.publish(
      setup,
      {
        ...article,
        bodyHtml: `<table><tr>${Array.from({ length: 7 }, () => `<td>${"long ".repeat(210)}</td>`).join("")}</tr></table>`,
      },
      false,
    );
    expect(f.send.mock.calls.length).toBeGreaterThan(1);
    expect(
      f.send.mock.calls.every(([options]) => options.flags === MessageFlags.IsComponentsV2),
    ).toBe(true);
    expect(
      f.send.mock.calls.every(
        ([options]) => JSON.stringify(options.components?.[0]?.toJSON?.()).length < 5000,
      ),
    ).toBe(true);
  });

  it("can create a post starting with an image without adding a media label", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    try {
      await f.publisher.publish(
        setup,
        { ...article, bodyHtml: '<img src="https://forum.netmarble.com/first.png"><p>After</p>' },
        false,
      );
      expect(f.create.mock.calls[0]![0].message.content).toBeUndefined();
      expect(f.create.mock.calls[0]![0].message.files).toMatchObject([
        { name: "media-109472-1.png" },
      ]);
      expect(f.create.mock.calls[0]![0].message.components[0]?.toJSON?.()).toMatchObject({
        items: [{ media: { url: "attachment://media-109472-1.png" } }],
      });
      expect(f.send.mock.calls[0]![0].components?.[0]?.data?.content).toBe("After");
    } finally {
      fetcher.mockRestore();
    }
  });

  it("falls back to a labelled URL at the image position on invalid content", async () => {
    const f = fixture();
    const fetcher = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response("not an image", { headers: { "content-type": "image/png" } }),
      );
    try {
      await f.publisher.publish(
        setup,
        {
          ...article,
          bodyHtml: '<p>Before</p><img src="https://forum.netmarble.com/bad.png"><p>After</p>',
        },
        false,
      );
      expect(f.send.mock.calls.map(([options]) => options.components?.[0]?.data?.content)).toEqual([
        "media-109472-2: https://forum.netmarble.com/bad.png",
        "After",
      ]);
    } finally {
      fetcher.mockRestore();
    }
  });

  it("falls back on Discord upload rejection without retrying an ambiguous creation error", async () => {
    const f = fixture();
    const fetcher = mockImageFetch();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejected = Object.assign(new Error("upload rejected"), { code: 40005 });
    try {
      f.create.mockRejectedValueOnce(rejected);
      await f.publisher.publish(
        setup,
        { ...article, bodyHtml: '<img src="https://forum.netmarble.com/a.png">' },
        false,
      );
      expect(f.create.mock.calls[1]![0].message.components[0]?.data?.content).toContain(
        "https://forum.netmarble.com/a.png",
      );
      f.create.mockRejectedValueOnce(new Error("connection lost"));
      await expect(
        f.publisher.publish(
          setup,
          { ...article, bodyHtml: '<img src="https://forum.netmarble.com/a.png">' },
          false,
        ),
      ).rejects.toThrow("connection lost");
      expect(f.create).toHaveBeenCalledTimes(3);
    } finally {
      fetcher.mockRestore();
      log.mockRestore();
    }
  });

  it("does not ping on historical posts and reconciles pins separately", async () => {
    const f = fixture();
    await f.publisher.publish(setup, { ...article, isSourcePinned: true }, false);
    expect(f.create.mock.calls[0]![0].message.components[0]?.data?.content).toBe(
      "Full **details**.",
    );
    expect(f.create.mock.calls[0]![0].message.allowedMentions).toEqual({ parse: [], roles: [] });
    expect(f.pin).not.toHaveBeenCalled();
    await f.publisher.setPin(setup, "thread", true);
    expect(f.pin).toHaveBeenCalledOnce();
    f.thread.flags.has.mockReturnValue(true);
    await f.publisher.setPin(setup, "thread", true);
    expect(f.pin).toHaveBeenCalledOnce();
    await f.publisher.setPin(setup, "thread", false);
    expect(f.unpin).toHaveBeenCalledOnce();
  });

  it("treats a deleted thread as unavailable for pinning and already unpinned", async () => {
    const f = fixture();
    await expect(f.publisher.setPin(setup, "missing", false)).resolves.toBe(false);
    await expect(f.publisher.setPin(setup, "missing", true)).resolves.toBe(false);
    f.fetchChannel.mockRejectedValueOnce(
      Object.assign(new Error("Unknown Channel"), { code: 10003 }),
    );
    await expect(f.publisher.setPin(setup, "thread", true)).resolves.toBe(false);
    f.pin.mockRejectedValueOnce(Object.assign(new Error("Unknown Channel"), { code: 10003 }));
    await expect(f.publisher.setPin(setup, "thread", true)).resolves.toBe(false);
    f.fetchChannel.mockRejectedValueOnce(
      Object.assign(new Error("Missing Access"), { code: 50001 }),
    );
    await expect(f.publisher.setPin(setup, "thread", true)).rejects.toThrow("Missing Access");
  });

  it("rejects a thread from another Forum", async () => {
    const f = fixture();
    f.thread.parentId = "different";
    await expect(f.publisher.setPin(setup, "thread", true)).rejects.toThrow("another Forum");
    expect(f.pin).not.toHaveBeenCalled();
  });
});

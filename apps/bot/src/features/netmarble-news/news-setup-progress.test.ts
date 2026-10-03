import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { NewsSetup } from "./news-setup.ts";
import type { SyncOptions } from "./news-synchronizer.ts";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  sync: vi.fn<(guildId: string, options?: SyncOptions) => Promise<unknown>>(),
  withGuildSetup: vi.fn(async (_guildId: string, operation: () => Promise<unknown>) => operation()),
}));
vi.mock("./news-setup-repository.ts", () => ({ createNewsSetupRepository: () => ({}) }));
vi.mock("./news-runtime.ts", () => ({
  createNewsRuntime: () => ({
    synchronizer: { syncGuild: mocks.sync, withGuildSetup: mocks.withGuildSetup },
  }),
}));
vi.mock("./news-setup.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./news-setup.ts")>()),
  createNewsSetup: mocks.create,
}));

import { handleNewsSetup } from "./news-setup-command.ts";

const setup: NewsSetup = {
  guildId: "guild",
  forumChannelId: "forum",
  enabled: true,
  initialImportMode: "backfill",
  initialBackfillCount: 10,
  initialImportCompleted: false,
  mappings: [{ menuSeq: 32, tagId: "tag", notificationRoleId: "role" }],
};

function fixture() {
  const editReply = vi.fn(async (_payload: { content: string }) => {});
  const deferReply = vi.fn(async () => {});
  const interaction = {
    inGuild: () => true,
    guild: { id: "guild" },
    guildId: "guild",
    memberPermissions: { has: () => true },
    client: { user: { id: "bot" } },
    user: { tag: "Admin" },
    options: { getSubcommand: () => "create", getInteger: () => null },
    editReply,
    deferReply,
  } as unknown as ChatInputCommandInteraction;
  return { interaction, editReply, deferReply };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockResolvedValue({ ...setup });
  mocks.sync.mockImplementation(async (_guildId, options) => {
    await options?.onProgress?.({ completed: 0, total: 2, published: 0, failed: 0 });
    await options?.onProgress?.({ completed: 1, total: 2, published: 1, failed: 0 });
    await options?.onProgress?.({ completed: 2, total: 2, published: 2, failed: 0 });
    return { published: 2, skipped: 0, failures: [], initial: true };
  });
});
afterEach(() => vi.restoreAllMocks());

describe("news setup progress", () => {
  it("shows setup stages and throttles rapid edits while always sending final progress and summary", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const f = fixture();
    await handleNewsSetup(f.interaction);
    expect(f.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const messages = f.editReply.mock.calls.map(([reply]) => reply.content);
    expect(messages[0]).toContain("Forum and category roles");
    expect(messages[1]).toBe("Fetching the latest news…");
    expect(messages[2]).toContain("**0/2**");
    expect(messages[3]).toContain("**2/2** processed — 2 published, 0 failed. Finalizing setup…");
    expect(messages[4]).toContain("News Forum ready: <#forum>");
    expect(messages).toHaveLength(5);
    expect(mocks.create.mock.calls[0]?.[2]).toBe(10);
  });

  it("shows intermediate progress and failures when enough time has elapsed", async () => {
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(3000)
      .mockReturnValueOnce(6000);
    mocks.sync.mockImplementation(async (_guildId, options) => {
      await options?.onProgress?.({ completed: 0, total: 2, published: 0, failed: 0 });
      await options?.onProgress?.({ completed: 1, total: 2, published: 0, failed: 1 });
      await options?.onProgress?.({ completed: 2, total: 2, published: 1, failed: 1 });
      return { published: 1, skipped: 0, failures: ["Article unavailable"], initial: true };
    });
    const f = fixture();
    await handleNewsSetup(f.interaction);
    expect(f.editReply.mock.calls.map(([reply]) => reply.content)).toContain(
      "Initial import: **1/2** processed — 0 published, 1 failed.",
    );
    expect(f.editReply.mock.lastCall?.[0].content).toContain("1 published, 0 skipped, 1 failed");
  });

  it("finalizes empty imports without dividing by zero", async () => {
    mocks.sync.mockImplementation(async (_guildId, options) => {
      await options?.onProgress?.({ completed: 0, total: 0, published: 0, failed: 0 });
      return { published: 0, skipped: 0, failures: [], initial: true };
    });
    const f = fixture();
    await handleNewsSetup(f.interaction);
    expect(f.editReply.mock.calls.map(([reply]) => reply.content)).toContain(
      "No articles to import. Finalizing setup…",
    );
    expect(f.editReply.mock.lastCall?.[0].content).toContain("News Forum ready");
  });

  it("does not rerun the import when reactivating a completed setup", async () => {
    mocks.create.mockResolvedValue({ ...setup, initialImportCompleted: true });
    const f = fixture();
    await handleNewsSetup(f.interaction);
    expect(mocks.sync).not.toHaveBeenCalled();
    expect(f.editReply.mock.lastCall?.[0].content).toContain("Already imported");
  });

  it("keeps importing when a progress reply fails", async () => {
    const f = fixture();
    f.editReply.mockRejectedValueOnce(new Error("Discord unavailable"));
    await handleNewsSetup(f.interaction);
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(f.editReply.mock.lastCall?.[0].content).toContain("News Forum ready");
  });
});

import { describe, expect, it, vi } from "vitest";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { slaCommand } from "../sla/sla.command.ts";
import { newsForumPermissions } from "./news-setup-command.ts";
import {
  cleanNewsSetup,
  createNewsSetup,
  disableNewsSetup,
  NEWS_TAGS,
  type NewsGuildGateway,
  type NewsSetup,
  type NewsSetupStore,
} from "./news-setup.ts";

function fixtures() {
  let saved: NewsSetup | null = null;
  const createdRoles: string[] = [];
  const removedRoles: string[] = [];
  const removedForums: string[] = [];
  const guild: NewsGuildGateway = {
    guildId: "123",
    preflight: vi.fn(async () => {}),
    resourcesExist: vi.fn(async () => true),
    createRole: vi.fn(async (name) => {
      createdRoles.push(name);
      return String(createdRoles.length);
    }),
    deleteRole: vi.fn(async (id) => {
      removedRoles.push(id);
    }),
    createForum: vi.fn(async (names: string[]) => ({
      id: "forum",
      tags: names.map((name, index) => ({ name, id: `tag-${index}` })),
    })),
    deleteForum: vi.fn(async (id) => {
      removedForums.push(id);
    }),
  };
  const store: NewsSetupStore = {
    get: vi.fn(async () => saved),
    save: vi.fn(async (setup) => {
      saved = setup;
    }),
    setEnabled: vi.fn(async (_, enabled) => {
      if (!saved) return false;
      saved = { ...saved, enabled };
      return true;
    }),
    publicationCount: vi.fn(async () => 2),
    delete: vi.fn(async (_, forumId) => {
      if (!saved || saved.forumChannelId !== forumId) return false;
      saved = null;
      return true;
    }),
  };
  return { guild, store, createdRoles, removedRoles, removedForums };
}

describe("news Forum setup", () => {
  it("registers publishing subcommands under /sla, not /setup", () => {
    expect(commands.some((command) => command.data.name === "setup")).toBe(false);
    const news = slaCommand.data.toJSON().options?.find(({ name }) => name === "news");
    expect(news?.type).toBe(ApplicationCommandOptionType.SubcommandGroup);
    if (news?.type !== ApplicationCommandOptionType.SubcommandGroup)
      throw new Error("News group missing");
    expect(news.options?.map(({ name }) => name)).toEqual([
      "create",
      "backfill",
      "status",
      "disable",
      "clean",
    ]);
  });

  it("exposes only a 0–10 backfill-count option on create", () => {
    const group = slaCommand.data.toJSON().options?.find(({ name }) => name === "news");
    if (group?.type !== ApplicationCommandOptionType.SubcommandGroup)
      throw new Error("News group missing");
    const create = group.options?.find(({ name }) => name === "create");
    expect(create?.options).toMatchObject([
      {
        name: "backfill-count",
        type: ApplicationCommandOptionType.Integer,
        min_value: 0,
        max_value: 10,
      },
    ]);
    expect(create?.options).toHaveLength(1);
  });

  it.each([0, 1, 10])(
    "persists an initial count of %i and derives its import mode",
    async (count) => {
      const f = fixtures();
      const setup = await createNewsSetup(f.guild, f.store, count);
      expect(setup.initialBackfillCount).toBe(count);
      expect(setup.initialImportMode).toBe(count === 0 ? "future_only" : "backfill");
    },
  );

  it.each([-1, 11, 1.5])(
    "rejects an invalid initial count of %s before creating resources",
    async (count) => {
      const f = fixtures();
      await expect(createNewsSetup(f.guild, f.store, count)).rejects.toThrow("between 0 and 10");
      expect(f.guild.preflight).not.toHaveBeenCalled();
    },
  );

  it("creates five manual roles, tags and a single persisted Forum", async () => {
    const f = fixtures();
    const setup = await createNewsSetup(f.guild, f.store);
    expect(setup.initialBackfillCount).toBe(10);
    expect(setup.mappings.map(({ menuSeq }) => menuSeq)).toEqual(
      NEWS_TAGS.map(({ menuSeq }) => menuSeq),
    );
    expect(f.createdRoles).toEqual(NEWS_TAGS.map(({ name }) => `SLA: ${name}`));
    expect(f.guild.createForum).toHaveBeenCalledTimes(1);
    await expect(createNewsSetup(f.guild, f.store)).rejects.toThrow("already configured");
    expect(f.guild.createForum).toHaveBeenCalledTimes(1);
  });

  it("keeps resources on disable and reactivates them without creating duplicates", async () => {
    const f = fixtures();
    await createNewsSetup(f.guild, f.store);
    await disableNewsSetup("123", f.store);
    const reactivated = await createNewsSetup(f.guild, f.store);
    expect(reactivated.enabled).toBe(true);
    expect(f.guild.createForum).toHaveBeenCalledTimes(1);
    expect(f.guild.createRole).toHaveBeenCalledTimes(5);
  });

  it("rejects reactivation when saved resources are missing", async () => {
    const f = fixtures();
    await createNewsSetup(f.guild, f.store);
    await disableNewsSetup("123", f.store);
    f.guild.resourcesExist = vi.fn(async () => false);
    await expect(createNewsSetup(f.guild, f.store)).rejects.toThrow("repair the configuration");
    expect(f.store.setEnabled).toHaveBeenCalledTimes(1);
  });

  it("rolls back Discord resources if persistence fails", async () => {
    const f = fixtures();
    f.store.save = vi.fn(async () => {
      throw new Error("Database unavailable");
    });
    await expect(createNewsSetup(f.guild, f.store)).rejects.toThrow("Database unavailable");
    expect(f.removedForums).toEqual(["forum"]);
    expect(f.removedRoles).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("rolls back when Discord omits a required tag", async () => {
    const f = fixtures();
    f.guild.createForum = vi.fn(async () => ({ id: "forum", tags: [] }));
    await expect(createNewsSetup(f.guild, f.store)).rejects.toThrow(
      "Forum tag Notices was not created",
    );
    expect(f.removedForums).toEqual(["forum"]);
    expect(f.removedRoles).toHaveLength(5);
  });

  it("deletes only saved resources and permits a fresh initial import afterward", async () => {
    const f = fixtures();
    const setup = await createNewsSetup(f.guild, f.store);
    const gate = {
      withGuildCleanup: vi.fn(async (_: string, work: () => Promise<boolean>) => work()),
    };
    const roles = setup.mappings.map(({ notificationRoleId }) => notificationRoleId);
    expect(await cleanNewsSetup(f.guild, f.store, gate, setup.forumChannelId, roles)).toBe(true);
    expect(f.removedForums).toEqual(["forum"]);
    expect(f.removedRoles).toEqual(roles);
    expect(await f.store.get("123")).toBeNull();
    expect(await cleanNewsSetup(f.guild, f.store, gate, setup.forumChannelId, roles)).toBe(false);
    const recreated = await createNewsSetup(f.guild, f.store);
    expect(recreated.initialImportCompleted).toBe(false);
    expect(recreated.mappings[0]?.notificationRoleId).toBe("6");
  });

  it("rejects stale confirmation without disabling or removing resources", async () => {
    const f = fixtures();
    const setup = await createNewsSetup(f.guild, f.store);
    const gate = { withGuildCleanup: async (_: string, work: () => Promise<boolean>) => work() };
    await expect(cleanNewsSetup(f.guild, f.store, gate, "other-forum", [])).rejects.toThrow(
      "changed since confirmation",
    );
    expect((await f.store.get("123"))?.enabled).toBe(true);
    expect(f.removedForums).toEqual([]);
    expect(f.store.delete).not.toHaveBeenCalled();
    expect(setup.forumChannelId).toBe("forum");
  });

  it("retains saved IDs on partial Discord failure and retries missing resources", async () => {
    const f = fixtures();
    const setup = await createNewsSetup(f.guild, f.store);
    const roles = setup.mappings.map(({ notificationRoleId }) => notificationRoleId);
    const gate = { withGuildCleanup: async (_: string, work: () => Promise<boolean>) => work() };
    vi.mocked(f.guild.deleteRole).mockRejectedValueOnce(new Error("Discord denied role deletion"));
    await expect(cleanNewsSetup(f.guild, f.store, gate, "forum", roles)).rejects.toThrow(
      "Could not delete roles 1",
    );
    expect((await f.store.get("123"))?.enabled).toBe(false);
    expect(f.store.delete).not.toHaveBeenCalled();
    expect(await cleanNewsSetup(f.guild, f.store, gate, "forum", roles)).toBe(true);
    expect(await f.store.get("123")).toBeNull();
    expect(f.removedForums).toEqual(["forum", "forum"]);
  });

  it("does not delete roles if the Forum deletion fails", async () => {
    const f = fixtures();
    const setup = await createNewsSetup(f.guild, f.store);
    const roles = setup.mappings.map(({ notificationRoleId }) => notificationRoleId);
    const gate = { withGuildCleanup: async (_: string, work: () => Promise<boolean>) => work() };
    vi.mocked(f.guild.deleteForum).mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(cleanNewsSetup(f.guild, f.store, gate, "forum", roles)).rejects.toThrow(
      "Could not delete Forum forum",
    );
    expect(f.removedRoles).toEqual([]);
    expect(f.store.delete).not.toHaveBeenCalled();
  });

  it("allows comments but denies member-created posts", () => {
    const [everyone, bot] = newsForumPermissions("123", "bot");
    expect(everyone?.deny).toContain(PermissionFlagsBits.SendMessages);
    expect(everyone?.deny).toContain(PermissionFlagsBits.CreatePublicThreads);
    expect(everyone?.allow).toContain(PermissionFlagsBits.SendMessagesInThreads);
    expect(bot?.allow).toContain(PermissionFlagsBits.ManageThreads);
    expect(bot?.allow).toContain(PermissionFlagsBits.SendMessages);
  });
});

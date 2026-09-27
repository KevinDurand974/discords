import { describe, expect, it, vi } from "vitest";
import { ApplicationCommandOptionType, PermissionFlagsBits } from "discord.js";
import { setupCommand } from "../setup/setup.command.ts";
import { newsForumPermissions } from "./news-setup-command.ts";
import {
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
  };
  return { guild, store, createdRoles, removedRoles, removedForums };
}

describe("news Forum setup", () => {
  it("registers all three news subcommands alongside existing log setup", () => {
    const options = setupCommand.data.toJSON().options ?? [];
    expect(options.map(({ name }) => name)).toEqual(["news", "logs"]);
    const news = options[0];
    expect(news?.type).toBe(ApplicationCommandOptionType.SubcommandGroup);
    if (news?.type !== ApplicationCommandOptionType.SubcommandGroup)
      throw new Error("News group missing");
    expect(news.options?.map(({ name }) => name)).toEqual(["create", "status", "disable"]);
  });

  it("creates five manual roles, tags and a single persisted Forum", async () => {
    const f = fixtures();
    const setup = await createNewsSetup(f.guild, f.store);
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

  it("allows comments but denies member-created posts", () => {
    const [everyone, bot] = newsForumPermissions("123", "bot");
    expect(everyone?.deny).toContain(PermissionFlagsBits.SendMessages);
    expect(everyone?.deny).toContain(PermissionFlagsBits.CreatePublicThreads);
    expect(everyone?.allow).toContain(PermissionFlagsBits.SendMessagesInThreads);
    expect(bot?.allow).toContain(PermissionFlagsBits.ManageThreads);
    expect(bot?.allow).toContain(PermissionFlagsBits.SendMessages);
  });
});

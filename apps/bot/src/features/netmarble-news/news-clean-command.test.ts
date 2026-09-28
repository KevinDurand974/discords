import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Guild,
} from "discord.js";
import type { NewsSetup } from "./news-setup.ts";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  publicationCount: vi.fn(),
  setEnabled: vi.fn(),
  delete: vi.fn(),
  withGuildCleanup: vi.fn(async (_guildId: string, work: () => Promise<boolean>) => work()),
}));
vi.mock("./news-setup-repository.ts", () => ({
  createNewsSetupRepository: () => mocks,
}));
vi.mock("./news-runtime.ts", () => ({
  createNewsRuntime: () => ({ synchronizer: mocks }),
}));

import {
  createNewsGuildGateway,
  handleNewsCleanConfirmation,
  handleNewsSetup,
} from "./news-setup-command.ts";

const setup: NewsSetup = {
  guildId: "guild-1",
  forumChannelId: "forum-1",
  enabled: true,
  initialImportMode: "backfill",
  initialBackfillCount: 10,
  initialImportCompleted: true,
  mappings: [{ menuSeq: 32, tagId: "tag-1", notificationRoleId: "role-1" }],
};

function fixture(admin: boolean) {
  const deleteForum = vi.fn(async () => {});
  const deleteRole = vi.fn(async () => {});
  const guild = {
    id: "guild-1",
    channels: {
      fetch: vi.fn(async () => ({
        id: "forum-1",
        type: ChannelType.GuildForum as ChannelType,
        delete: deleteForum,
      })),
    },
    roles: { fetch: vi.fn(async () => ({ id: "role-1", managed: false, delete: deleteRole })) },
  };
  const memberPermissions = {
    has: (permission: bigint) => permission === PermissionFlagsBits.ManageChannels || admin,
  };
  const reply = vi.fn(
    async (_payload: {
      content: string;
      components: { toJSON(): { components: { custom_id?: string }[] } }[];
    }) => {},
  );
  const client = { user: { id: "bot-1" } };
  return {
    guild,
    memberPermissions,
    reply,
    client,
    deleteForum,
    deleteRole,
    slash: {
      inGuild: () => true,
      guild,
      guildId: guild.id,
      memberPermissions,
      options: { getSubcommand: () => "clean" },
      user: { id: "admin-1", tag: "Admin" },
      reply,
      client,
    } as unknown as ChatInputCommandInteraction,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(setup);
  mocks.publicationCount.mockResolvedValue(2);
  mocks.setEnabled.mockResolvedValue(true);
  mocks.delete.mockResolvedValue(true);
});

describe("administrator news cleanup confirmation", () => {
  it("treats missing Discord resources as deleted, but refuses unrelated channel types", async () => {
    const f = fixture(true);
    const gateway = createNewsGuildGateway(f.guild as unknown as Guild, "bot-1", "Admin");
    f.guild.channels.fetch.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: 10003 }));
    f.guild.roles.fetch.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: 10011 }));
    await expect(gateway.deleteForum("forum-1")).resolves.toBeUndefined();
    await expect(gateway.deleteRole("role-1")).resolves.toBeUndefined();
    expect(f.deleteForum).not.toHaveBeenCalled();
    expect(f.deleteRole).not.toHaveBeenCalled();
    f.guild.channels.fetch.mockResolvedValueOnce({
      id: "forum-1",
      type: ChannelType.GuildText,
      delete: f.deleteForum,
    });
    await expect(gateway.deleteForum("forum-1")).rejects.toThrow("not a Forum");
    expect(f.deleteForum).not.toHaveBeenCalled();
  });
  it("refuses the preview without Administrator permission", async () => {
    const f = fixture(false);
    await expect(handleNewsSetup(f.slash)).rejects.toThrow("Only a server administrator");
    expect(mocks.get).not.toHaveBeenCalled();
    expect(f.reply).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("lists exact resources without deleting them until the same admin confirms", async () => {
    const f = fixture(true);
    await handleNewsSetup(f.slash);
    const preview = f.reply.mock.calls[0]![0];
    expect(preview.content).toContain("Forum: <#forum-1> (ID forum-1)");
    expect(preview.content).toContain("<@&role-1> (ID role-1)");
    expect(preview.content).toContain("**2** imported-article records");
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
    const customId = preview.components[0]!.toJSON().components[0]!.custom_id;
    const deferUpdate = vi.fn(async () => {});
    const editReply = vi.fn(async (_payload: { components: unknown[] }) => {});
    const button = (userId: string, admin = true) =>
      ({
        isButton: () => true,
        inGuild: () => true,
        guild: f.guild,
        guildId: f.guild.id,
        user: { id: userId, tag: "Admin" },
        memberPermissions: { has: () => admin },
        client: f.client,
        customId,
        deferUpdate,
        editReply,
      }) as unknown as ButtonInteraction;
    await expect(handleNewsCleanConfirmation(button("intruder"))).rejects.toThrow(
      "belongs to another administrator",
    );
    await expect(handleNewsCleanConfirmation(button("admin-1", false))).rejects.toThrow(
      "Only a server administrator",
    );
    expect(mocks.setEnabled).not.toHaveBeenCalled();
    await handleNewsCleanConfirmation(button("admin-1"));
    expect(deferUpdate).toHaveBeenCalledOnce();
    expect(f.guild.channels.fetch).toHaveBeenCalledWith("forum-1");
    expect(f.guild.roles.fetch).toHaveBeenCalledWith("role-1");
    expect(f.deleteForum).toHaveBeenCalledOnce();
    expect(f.deleteRole).toHaveBeenCalledOnce();
    expect(mocks.delete).toHaveBeenCalledWith("guild-1", "forum-1");
    expect(editReply.mock.calls[0]![0].components).toEqual([]);
  });
});

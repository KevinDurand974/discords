import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ComponentType,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ModalBuilder,
} from "discord.js";
import {
  autocompleteYoutubeTag,
  requireVideoPermission,
  youtubeCommand,
  youtubeComponentHandler,
} from "./videos.command.ts";
import { commands, componentHandlers } from "../../core/command-registry.ts";
import { slaCommand } from "../sla/sla.command.ts";
import { pingCommand } from "../utility/ping.command.ts";
import type { CommandExecutionContext } from "../../core/command.ts";

const forumId = "123456789012345678";
const tagId = "223456789012345678";
const runtime = vi.hoisted(() => ({
  store: {
    get: vi.fn(),
    subscriptions: vi.fn(async () => []),
    counts: vi.fn(async () => "no videos"),
  },
  setup: vi.fn(),
  add: vi.fn(),
  clean: vi.fn(),
  sync: vi.fn(),
  creatorTags: vi.fn(),
}));
vi.mock("./videos-runtime.ts", () => ({ createVideosRuntime: () => runtime }));
function actor(permissions: bigint[], userId = "moderator") {
  return {
    guild: { id: "guild", ownerId: "owner" },
    guildId: "guild",
    user: { id: userId },
    memberPermissions: new PermissionsBitField(permissions),
  };
}
const context = {} as CommandExecutionContext;
beforeEach(() => {
  vi.clearAllMocks();
  runtime.store.get.mockResolvedValue({
    forumChannelId: forumId,
    forumGeneration: 1,
    lifecycle: "active",
    ownsForum: true,
  });
  runtime.creatorTags.mockResolvedValue([{ id: tagId, name: "Creator" }]);
  runtime.setup.mockResolvedValue({ forum: { id: forumId } });
  runtime.add.mockResolvedValue({ forumId, reused: false, published: 1, failures: [] });
});
async function addModal() {
  const showModal = vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {});
  await youtubeCommand.execute({
    ...actor([P.ManageMessages]),
    options: { getSubcommand: () => "add", getInteger: () => null },
    showModal,
  } as unknown as ChatInputCommandInteraction);
  return showModal.mock.calls[0]![0];
}
async function cleanupPrompt(tag: string | null = null) {
  const editReply = vi.fn();
  await youtubeCommand.execute({
    ...actor([P.Administrator]),
    options: { getSubcommand: () => "clean", getString: () => tag },
    deferReply: vi.fn(),
    editReply,
  } as unknown as ChatInputCommandInteraction);
  return editReply.mock.calls[0]![0];
}
function button(customId: string, userId = "moderator") {
  return {
    ...actor([P.Administrator], userId),
    customId,
    isButton: () => true,
    isModalSubmit: () => false,
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
  } as unknown as ButtonInteraction;
}
describe("YouTube commands, permissions and confirmation ownership", () => {
  it("registers all YouTube subcommands under /youtube and removes /setup", () => {
    expect(commands).toContain(youtubeCommand);
    expect(componentHandlers).toContain(youtubeComponentHandler);
    expect(commands.map((command) => command.data.name)).toEqual([
      "logs",
      "welcome",
      "reaction-roles",
      "rules",
      "trap",
      "untrap",
      "unban",
      "give-role",
      "strip-role",
      "sla",
      "ping",
      "coinflip",
      "pick",
      "slowmode",
      "clear",
      "visibility",
      "help",
      "youtube",
      "poll",
      "ticket",
      "close-ticket",
    ]);
    expect(youtubeCommand.data.toJSON().options?.map((option) => option.name)).toEqual([
      "setup",
      "clean",
      "add",
      "status",
      "sync",
    ]);
    expect(youtubeCommand.data.toJSON().default_member_permissions).toBeUndefined();
  });
  it("keeps news under /sla and registers /youtube clean with tag autocomplete", () => {
    expect(slaCommand.data.toJSON().options?.map((option) => option.name)).toContain("news");
    expect(youtubeCommand.autocomplete).toBe(autocompleteYoutubeTag);
    expect(youtubeCommand.data.toJSON().options).toContainEqual(
      expect.objectContaining({
        name: "clean",
        options: [expect.objectContaining({ name: "tag", autocomplete: true })],
      }),
    );
    expect(pingCommand.data.toJSON().options ?? []).toEqual([]);
  });
  it("denies ordinary members, allows Manage Messages and accepts administrator/owner bypass", () => {
    expect(() => requireVideoPermission(actor([]) as ChatInputCommandInteraction)).toThrow(
      "Manage Messages",
    );
    for (const user of [actor([P.ManageMessages]), actor([P.Administrator]), actor([], "owner")])
      expect(() => requireVideoPermission(user as ChatInputCommandInteraction)).not.toThrow();
  });
  it("requires Administrator for cleanup, including component submits", () => {
    expect(() =>
      requireVideoPermission(actor([P.ManageMessages]) as ChatInputCommandInteraction, true),
    ).toThrow("administrator");
    expect(() =>
      requireVideoPermission(actor([P.Administrator]) as ChatInputCommandInteraction, true),
    ).not.toThrow();
  });
  it("creates the Forum explicitly via /youtube setup with only Manage Channels", async () => {
    await youtubeCommand.execute({
      ...actor([P.ManageChannels]),
      options: { getSubcommand: () => "setup" },
      deferReply: vi.fn(),
      editReply: vi.fn(),
    } as unknown as ChatInputCommandInteraction);
    expect(runtime.setup).toHaveBeenCalledWith("guild");
    expect(runtime.add).not.toHaveBeenCalled();
  });
  it("requires Manage Channels for setup", async () => {
    await expect(
      youtubeCommand.execute({
        ...actor([P.ManageMessages]),
        options: { getSubcommand: () => "setup" },
      } as unknown as ChatInputCommandInteraction),
    ).rejects.toThrow("Manage Channels");
    expect(runtime.setup).not.toHaveBeenCalled();
  });
  it.each([
    { action: "setup", permissions: [], error: "Manage Channels" },
    { action: "clean", permissions: [P.ManageChannels], error: "administrator" },
    { action: "clean", permissions: [P.ManageMessages], error: "administrator" },
    { action: "add", permissions: [P.ManageChannels], error: "Manage Messages" },
    { action: "status", permissions: [], error: "Manage Messages" },
    { action: "sync", permissions: [], error: "Manage Messages" },
  ])(
    "rejects unauthorized /youtube $action before side effects",
    async ({ action, permissions, error }) => {
      const deferReply = vi.fn();
      await expect(
        youtubeCommand.execute({
          ...actor(permissions),
          options: { getSubcommand: () => action },
          deferReply,
        } as unknown as ChatInputCommandInteraction),
      ).rejects.toThrow(error);
      expect(deferReply).not.toHaveBeenCalled();
      expect(runtime.setup).not.toHaveBeenCalled();
      expect(runtime.clean).not.toHaveBeenCalled();
      expect(runtime.add).not.toHaveBeenCalled();
      expect(runtime.sync).not.toHaveBeenCalled();
    },
  );
  it.each(["setup", "clean"])("allows the server owner to use /youtube %s", async (action) => {
    const editReply = vi.fn();
    await youtubeCommand.execute({
      ...actor([], "owner"),
      options: { getSubcommand: () => action, getString: () => null },
      deferReply: vi.fn(),
      editReply,
    } as unknown as ChatInputCommandInteraction);
    expect(editReply).toHaveBeenCalledOnce();
    if (action === "setup") expect(runtime.setup).toHaveBeenCalledWith("guild");
    else expect(editReply.mock.calls[0]![0].components).toHaveLength(1);
  });
  it("opens a creator modal with a Forum selector defaulting to the configured channel", async () => {
    const modal = (await addModal()).toJSON();
    expect(modal.components).toContainEqual(
      expect.objectContaining({
        type: ComponentType.Label,
        component: expect.objectContaining({
          custom_id: "forum-channel",
          channel_types: [ChannelType.GuildForum],
          default_values: [{ id: forumId, type: "channel" }],
        }),
      }),
    );
    expect(runtime.setup).not.toHaveBeenCalled();
    expect(runtime.add).not.toHaveBeenCalled();
  });
  it("allows an explicit Forum selection without a default setup", async () => {
    runtime.store.get.mockResolvedValueOnce(null);
    const modal = (await addModal()).toJSON();
    expect(JSON.stringify(modal)).not.toContain("default_values");
  });
  it("passes the selected Forum to add and never implicitly provisions a Forum", async () => {
    const modal = await addModal();
    await youtubeComponentHandler.execute(
      {
        ...actor([P.ManageMessages]),
        customId: modal.data.custom_id,
        isModalSubmit: () => true,
        isButton: () => false,
        deferReply: vi.fn(),
        editReply: vi.fn(),
        fields: {
          getTextInputValue: () => "@creator",
          getSelectedChannels: () => new Collection([[forumId, { id: forumId }]]),
        },
      } as unknown as ModalSubmitInteraction,
      context,
    );
    expect(runtime.add).toHaveBeenCalledWith("guild", "@creator", 10, forumId);
    expect(runtime.setup).not.toHaveBeenCalled();
  });
  it("binds the modal to its actor/guild and rejects expired sessions", async () => {
    vi.useFakeTimers();
    try {
      const modal = await addModal();
      const submit = (userId: string, guildId = "guild") =>
        ({
          ...actor([P.ManageMessages], userId),
          guildId,
          customId: modal.data.custom_id,
          isModalSubmit: () => true,
          isButton: () => false,
        }) as unknown as ModalSubmitInteraction;
      await expect(
        youtubeComponentHandler.execute(submit("different-moderator"), context),
      ).rejects.toThrow("belongs to another user");
      await expect(
        youtubeComponentHandler.execute(submit("moderator", "other-guild"), context),
      ).rejects.toThrow("belongs to another user");
      vi.advanceTimersByTime(300_001);
      await expect(youtubeComponentHandler.execute(submit("moderator"), context)).rejects.toThrow(
        "expired",
      );
    } finally {
      vi.useRealTimers();
    }
  });
  it("autocompletes current creator tags with name filtering", async () => {
    const respond = vi.fn();
    await autocompleteYoutubeTag({
      ...actor([P.Administrator]),
      options: { getFocused: () => "CRE" },
      respond,
    } as unknown as AutocompleteInteraction);
    expect(respond).toHaveBeenCalledWith([{ name: "Creator", value: tagId }]);
  });
  it("does not offer cleanup tags to ordinary members", async () => {
    const respond = vi.fn();
    await autocompleteYoutubeTag({ ...actor([]), respond } as unknown as AutocompleteInteraction);
    expect(respond).toHaveBeenCalledWith([]);
    expect(runtime.creatorTags).not.toHaveBeenCalled();
  });
  it("requires an actual current creator tag, not a forged arbitrary ID", async () => {
    await expect(cleanupPrompt("invalid")).rejects.toThrow("current creator tag");
    expect(runtime.clean).not.toHaveBeenCalled();
  });
  it.each(["videos", "resources"])(
    "asks for a choice and confirms %s cleanup within the selected creator scope",
    async (mode) => {
      const prompt = await cleanupPrompt(tagId);
      expect(prompt.content).toContain("choose what to remove");
      expect(prompt.components[0].components).toHaveLength(3);
      expect(runtime.clean).not.toHaveBeenCalled();
      const customId = prompt.components[0].components.find(
        (item: { data: { custom_id: string } }) => item.data.custom_id.includes(`:${mode}:`),
      ).data.custom_id;
      await youtubeComponentHandler.execute(button(customId), context);
      expect(runtime.clean).toHaveBeenCalledWith("guild", forumId, 1, mode, tagId);
      await expect(youtubeComponentHandler.execute(button(customId), context)).rejects.toThrow(
        "expired",
      );
    },
  );
  it("uses all creators when tag is omitted and supports cancelling without deletion", async () => {
    const prompt = await cleanupPrompt();
    expect(prompt.content).toContain("all creators");
    const customId = prompt.components[0].components[2].data.custom_id;
    await youtubeComponentHandler.execute(button(customId), context);
    expect(runtime.clean).not.toHaveBeenCalled();
  });
  it("rejects cleanup confirmation by another actor", async () => {
    const prompt = await cleanupPrompt();
    const customId = prompt.components[0].components[0].data.custom_id;
    await expect(
      youtubeComponentHandler.execute(button(customId, "other-admin"), context),
    ).rejects.toThrow("belongs to another user");
    expect(runtime.clean).not.toHaveBeenCalled();
  });
});

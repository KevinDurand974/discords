import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  Events,
  MessageFlags,
  PermissionFlagsBits as P,
  type Client,
  type MessageReaction,
  type ModalSubmitInteraction,
  type Role,
  type GuildMember,
  type User,
} from "discord.js";
import {
  assertSafeReactionRole,
  emojiKey,
  parseReactionEmoji,
  parseReactionRoles,
} from "./reaction-role-model.ts";
import { createReactionRoleRuntime, registerReactionRoleRuntime } from "./reaction-role-runtime.ts";
import {
  createReactionRolesModal,
  createReactionRoleEntryModal,
  createReactionRolePreview,
  createReactionRolesComponentHandler,
  publishReactionRoles,
  reactionRolesCommand,
  reactionRolesComponentHandler,
} from "./reaction-roles.command.ts";
import type { ReactionRoleStore } from "./reaction-role-repository.ts";
import {
  createReactionRoleMessagePayload,
  createReactionRoleNotice,
  REACTION_ROLE_TITLE,
} from "./reaction-role-messages.ts";
import { commands, componentHandlers } from "@/core/command-registry.ts";

const ids = {
  user: "111111111111111111",
  guild: "222222222222222222",
  channel: "333333333333333333",
  role: "444444444444444444",
};
const mappings = [{ emoji: "🎮", key: "🎮", roleId: ids.role }];
function fixture() {
  const permissions = { has: vi.fn(() => true) };
  const highest = { comparePositionTo: vi.fn(() => 1) };
  const role = {
    id: ids.role,
    managed: false,
    editable: true,
    permissions: { bitfield: 0n },
    guild: { id: ids.guild, ownerId: "owner" },
  };
  const bot = { permissions, roles: { highest } };
  const roles = {
    highest,
    cache: new Collection<string, typeof role>(),
    add: vi.fn(async () => {
      roles.cache.set(role.id, role);
    }),
    remove: vi.fn(async () => {
      roles.cache.delete(role.id);
    }),
  };
  const member = { id: ids.user, permissions, roles };
  const message = {
    id: "555555555555555555",
    guildId: ids.guild,
    channelId: ids.channel,
    partial: false,
    inGuild: () => true,
    author: { id: "bot" },
    react: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
    guild: {} as unknown,
    channel: { permissionsFor: () => permissions },
  };
  const channel = {
    id: ids.channel,
    type: ChannelType.GuildText,
    permissionsFor: () => permissions,
    send: vi.fn(async () => message),
  };
  const guild = {
    id: ids.guild,
    channels: { fetch: vi.fn(async () => channel) },
    members: { fetchMe: vi.fn(async () => bot), fetch: vi.fn(async () => member) },
    roles: { fetch: vi.fn(async () => role) },
    emojis: { fetch: vi.fn(async () => {}), cache: new Collection() },
  };
  message.guild = guild;
  const settings = { messageId: message.id, guildId: ids.guild, channelId: ids.channel, mappings };
  const store = {
    get: vi.fn(async (): Promise<Awaited<ReturnType<ReactionRoleStore["get"]>>> => settings),
    list: vi.fn(async () => []),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  } satisfies ReactionRoleStore;
  const reaction = {
    client: { user: { id: "bot" } },
    message,
    emoji: { id: null, name: "🎮" },
    users: { remove: vi.fn(async () => {}) },
  };
  const user = { id: ids.user, bot: false, partial: false };
  const interaction = {
    inGuild: () => true,
    guild,
    user,
    memberPermissions: permissions,
    customId: `reaction-roles:${ids.user}:${ids.guild}:${ids.channel}`,
    fields: {
      getSelectedChannels: vi.fn(() => new Collection()),
      getTextInputValue: vi.fn((id: string) =>
        id === "content" ? "Pick your roles" : `🎮 - <@&${ids.role}>`,
      ),
    },
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async (_options: unknown) => ({ id: "preview" })),
    deleteReply: vi.fn(async () => {}),
  };
  const draft = {
    userId: ids.user,
    guildId: ids.guild,
    channelId: ids.channel,
    content: "Pick your roles",
    mappings: [...mappings],
  };
  return {
    draft,
    permissions,
    highest,
    role,
    roles,
    member,
    bot,
    guild,
    channel,
    message,
    store,
    reaction,
    user,
    interaction,
    submit: interaction as unknown as ModalSubmitInteraction,
    click: reaction as unknown as MessageReaction,
    actor: user as unknown as User,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reaction role parsing and safety", () => {
  it("parses Unicode, composite and server custom emojis with role mentions", () => {
    expect(
      parseReactionRoles(`🎮 - <@&${ids.role}>\r\n\n <:game:666666666666666666> - <@&${ids.role}>`),
    ).toEqual([
      ...mappings,
      { emoji: "<:game:666666666666666666>", key: "666666666666666666", roleId: ids.role },
    ]);
    ["👨‍👩‍👧‍👦", "🇫🇷", "1️⃣", "👍🏽", "❤️"].forEach((emoji) =>
      expect(parseReactionRoles(`${emoji} - <@&${ids.role}>`)).toHaveLength(1),
    );
    expect(emojiKey({ id: null, name: "❤️" })).toBe("❤");
  });
  it("rejects malformed lines, ambiguous duplicates and too many mappings", () => {
    [
      "",
      "🎮 - @Gamers",
      `abc - <@&${ids.role}>`,
      `🎮🎲 - <@&${ids.role}>`,
      `🎮 - <@&${ids.role}>\n🎮 - <@&${ids.role}>`,
      `❤ - <@&${ids.role}>\n❤️ - <@&${ids.role}>`,
      Array(21).fill(`🎮 - <@&${ids.role}>`).join("\n"),
    ].forEach((input) => expect(() => parseReactionRoles(input)).toThrow());
  });
  it("allows permissions, including Administrator, but rejects managed, everyone and hierarchy-inaccessible roles", () => {
    const f = fixture();
    const assert = () =>
      assertSafeReactionRole(f.role as unknown as Role, f.bot as unknown as GuildMember);
    expect(assert).not.toThrow();
    f.role.permissions.bitfield = P.Administrator;
    expect(assert).not.toThrow();
    f.role.permissions.bitfield = P.SendMessages | P.Connect;
    expect(assert).not.toThrow();
    f.role.managed = true;
    expect(assert).toThrow();
    f.role.managed = false;
    f.role.id = ids.guild;
    expect(assert).toThrow();
    f.role.id = ids.role;
    f.highest.comparePositionTo.mockReturnValue(0);
    expect(assert).toThrow();
  });
});

describe("reaction role setup", () => {
  it("registers the command, handler and two-field modal with the current channel selected", () => {
    expect(commands).toContain(reactionRolesCommand);
    expect(componentHandlers).toContain(reactionRolesComponentHandler);
    expect(reactionRolesCommand.data.toJSON()).toMatchObject({
      name: "reaction-roles",
      contexts: [0],
      default_member_permissions: String(P.ManageRoles),
    });
    const modal = createReactionRolesModal(ids.user, ids.guild, ids.channel).toJSON();
    expect(modal.components).toHaveLength(2);
    expect(modal.components.map((component) => component.id)).toEqual([1, 3]);
    expect(modal.components[0]).toMatchObject({
      component: { default_values: [{ id: ids.channel, type: "channel" }] },
    });
  });
  it("publishes in the default channel, persists before seeding and suppresses mentions", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await publishReactionRoles(f.submit, f.store, f.draft);
    expect(f.guild.channels.fetch).toHaveBeenCalledWith(ids.channel);
    expect(f.channel.send).toHaveBeenCalledWith(
      createReactionRoleMessagePayload("Pick your roles", mappings),
    );
    expect(f.store.save).toHaveBeenCalledWith({
      messageId: f.message.id,
      guildId: ids.guild,
      channelId: ids.channel,
      mappings,
    });
    expect(f.message.react).toHaveBeenCalledWith("🎮");
    expect(f.store.save.mock.invocationCallOrder[0]).toBeLessThan(
      f.message.react.mock.invocationCallOrder[0]!,
    );
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.message.delete).not.toHaveBeenCalled();
  });
  it("uses a selected destination instead of the original channel", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.draft.channelId = "other";
    await publishReactionRoles(f.submit, f.store, f.draft);
    expect(f.guild.channels.fetch).toHaveBeenCalledWith("other");
    expect(f.store.save).toHaveBeenCalledWith(expect.objectContaining({ channelId: "other" }));
  });
  it("rejects another user's form, unsafe roles and missing permissions before publication", async () => {
    const f = fixture();
    f.draft.userId = "999";
    await expect(publishReactionRoles(f.submit, f.store, f.draft)).rejects.toThrow("another user");
    f.draft.userId = ids.user;
    f.role.managed = true;
    await expect(publishReactionRoles(f.submit, f.store, f.draft)).rejects.toThrow("unmanaged");
    f.permissions.has.mockReturnValue(false);
    await expect(publishReactionRoles(f.submit, f.store, f.draft)).rejects.toThrow("Manage Roles");
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("cleans up the message when persistence fails, and mappings when reaction seeding fails", async () => {
    const f = fixture();
    f.store.save.mockRejectedValueOnce(new Error("offline"));
    await expect(publishReactionRoles(f.submit, f.store, f.draft)).rejects.toThrow("offline");
    expect(f.message.delete).toHaveBeenCalledOnce();
    expect(f.message.react).not.toHaveBeenCalled();
    f.message.react.mockRejectedValueOnce(new Error("emoji unavailable"));
    await expect(publishReactionRoles(f.submit, f.store, f.draft)).rejects.toThrow(
      "emoji unavailable",
    );
    expect(f.store.remove).toHaveBeenCalledWith(f.message.id);
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

describe("reaction role Components V2 messages", () => {
  it("uses a titled container and the entered content as the description, without legacy content or embeds", () => {
    const content = "Choose **your team**!\n<@&123456789012345678>";
    const payload = createReactionRoleMessagePayload(content);
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions).toEqual({ parse: [] });
    expect(payload).not.toHaveProperty("content");
    expect(payload).not.toHaveProperty("embeds");
    expect(payload.components.map((component) => component.toJSON())).toEqual([
      expect.objectContaining({
        type: 17,
        accent_color: 0x5865f2,
        components: [
          expect.objectContaining({ type: 10, content: REACTION_ROLE_TITLE }),
          expect.objectContaining({ type: 14, divider: true }),
          expect.objectContaining({ type: 10, content }),
        ],
      }),
    ]);
  });
  it("adds a separator and a text explanation of every emoji and role to the published message", () => {
    const entries = [...mappings, { emoji: "❤️", key: "❤", roleId: "666666666666666666" }];
    const payload = createReactionRoleMessagePayload("Pick your roles", entries);
    expect(payload.components[0]!.toJSON()).toMatchObject({
      components: [
        { type: 10, content: REACTION_ROLE_TITLE },
        { type: 14 },
        { type: 10, content: "Pick your roles" },
        { type: 14, divider: true },
        {
          type: 10,
          content: `**React to toggle a role**\n🎮 → <@&${ids.role}>\n❤️ → <@&666666666666666666>`,
        },
      ],
    });
    expect(payload.allowedMentions).toEqual({ parse: [] });
  });
  it("rejects overlong published role explanations instead of omitting mappings", () => {
    const entries = Array.from({ length: 20 }, () => ({
      emoji: "👍" + "\u{E0061}".repeat(40) + "\u{E007F}",
      key: "emoji",
      roleId: ids.role,
    }));
    expect(() => createReactionRoleMessagePayload("x".repeat(2000), entries)).toThrow(
      "4000 characters",
    );
  });
  it("keeps maximum-length descriptions intact and bounds preview text to the V2 limit", () => {
    const f = fixture();
    const content = "x".repeat(2000);
    const mappings = Array.from({ length: 20 }, (_, index) => ({
      emoji: "👍" + "\u{E0061}".repeat(40) + "\u{E007F}",
      key: `${index}`,
      roleId: ids.role,
    }));
    const preview = createReactionRolePreview("draft", { ...f.draft, content, mappings });
    const serialized = preview.components[0]!.toJSON() as {
      components: { type: number; content?: string }[];
    };
    const texts = serialized.components
      .filter((component) => component.type === 10)
      .map((component) => component.content!);
    expect(texts).toContain(content);
    expect(texts.reduce((count, text) => count + text.length, 0)).toBeLessThanOrEqual(4000);
    expect(texts.join("\n")).toContain("more configured.");
  });
});

describe("reaction role preview workflow", () => {
  async function setup() {
    const f = fixture();
    const getStore = vi.fn(() => f.store);
    const handler = createReactionRolesComponentHandler(getStore);
    const modal = {
      ...f.interaction,
      customId: `reaction-roles:setup:${ids.user}:${ids.guild}:${ids.channel}`,
      isModalSubmit: () => true,
      isButton: () => false,
    };
    await handler.execute(modal as unknown as ModalSubmitInteraction, undefined!);
    const preview = f.interaction.editReply.mock.calls.at(-1)![0] as ReturnType<
      typeof createReactionRolePreview
    >;
    const row = preview.components[1]!.toJSON() as { components: { custom_id: string }[] };
    const customId = row.components[0]!.custom_id;
    const draftId = customId.split(":")[2]!;
    const button = {
      ...f.interaction,
      message: { id: "preview" },
      customId: `reaction-roles:add:${draftId}`,
      isButton: () => true,
      isModalSubmit: () => false,
      deferUpdate: vi.fn(async () => {}),
      showModal: vi.fn(async (_modal: unknown) => {}),
    };
    const entry = {
      ...f.interaction,
      message: { id: "preview" },
      customId: `reaction-roles:entry:${draftId}`,
      isButton: () => false,
      isModalSubmit: () => true,
      isFromMessage: () => true,
      deferUpdate: vi.fn(async () => {}),
      fields: {
        getTextInputValue: vi.fn(() => "❤️"),
        getSelectedRoles: vi.fn(() => new Collection([[ids.role, f.role]])),
      },
    };
    return { ...f, handler, getStore, button, entry, draftId, preview };
  }
  it("shows an ephemeral preview without publishing, with Add and Validate in one row", async () => {
    const f = await setup();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.getStore).not.toHaveBeenCalled();
    expect(f.preview.flags).toBe(MessageFlags.IsComponentsV2);
    expect(f.preview).not.toHaveProperty("content");
    expect(f.preview).not.toHaveProperty("embeds");
    expect(f.preview.components).toHaveLength(2);
    expect(f.preview.components[0]!.toJSON()).toMatchObject({
      type: 17,
      components: [
        { type: 10, content: REACTION_ROLE_TITLE },
        { type: 14 },
        { type: 10, content: "Pick your roles" },
        { type: 14 },
        { type: 10, content: expect.stringContaining("No reactions yet.") },
        { type: 14 },
        { type: 10, content: expect.stringContaining("Administrator") },
      ],
    });
    expect(f.preview.components[1]!.toJSON()).toMatchObject({
      type: 1,
      components: [{ label: "Add" }, { label: "Validate" }],
    });
    await f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!);
    expect(f.button.showModal).toHaveBeenCalledOnce();
    const modal = createReactionRoleEntryModal(f.draftId).toJSON();
    expect(modal.components).toHaveLength(2);
    expect(modal.components[1]).toMatchObject({
      component: { type: 6, min_values: 1, max_values: 1 },
    });
  });
  it("accepts one combined emoji and a role with permissions, then publishes only on Validate", async () => {
    vi.useFakeTimers();
    const f = await setup();
    f.role.permissions.bitfield = P.Administrator;
    await f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!);
    const updated = f.interaction.editReply.mock.calls.at(-1)![0] as ReturnType<
      typeof createReactionRolePreview
    >;
    expect(JSON.stringify(updated.components.map((component) => component.toJSON()))).toContain(
      `❤️ → <@&${ids.role}>`,
    );
    expect(f.channel.send).not.toHaveBeenCalled();
    f.button.customId = `reaction-roles:validate:${f.draftId}`;
    await f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!);
    expect(f.message.react).toHaveBeenCalledWith("❤️");
    expect(f.store.save).toHaveBeenCalledWith(
      expect.objectContaining({ mappings: [{ emoji: "❤️", key: "❤", roleId: ids.role }] }),
    );
    await expect(
      f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("expired");
  });
  it("cancels when validating an empty draft", async () => {
    vi.useFakeTimers();
    const f = await setup();
    f.button.customId = `reaction-roles:validate:${f.draftId}`;
    await f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!);
    expect(f.interaction.editReply).toHaveBeenLastCalledWith(
      createReactionRoleNotice("Cancelled. No reactions were configured."),
    );
    expect(f.getStore).not.toHaveBeenCalled();
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("rejects text, empty inputs and multiple emojis, including combined emoji pairs", () => {
    [
      "",
      "a",
      "hello",
      "🎮🎲",
      "❤️👍🏽",
      "🎮\n🎲",
      "<:one:111111111111111111><:two:222222222222222222>",
    ].forEach((emoji) => expect(() => parseReactionEmoji(emoji)).toThrow("exactly one"));
    ["❤️", "👍🏽", "👨‍👩‍👧‍👦", "🇫🇷", "1️⃣"].forEach((emoji) =>
      expect(parseReactionEmoji(emoji).emoji).toBe(emoji),
    );
  });
  it("rejects duplicate emojis and unsafe roles without publishing", async () => {
    const f = await setup();
    f.entry.fields.getTextInputValue.mockReturnValue("🎮🎲");
    await expect(
      f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("exactly one");
    f.entry.fields.getTextInputValue.mockReturnValue("❤️");
    await f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!);
    f.entry.fields.getTextInputValue.mockReturnValue("❤");
    await expect(
      f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("already configured");
    f.entry.fields.getTextInputValue.mockReturnValue("🎮");
    f.role.managed = true;
    await expect(
      f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("unmanaged");
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("binds drafts to the owner, guild and preview, and expires them after 15 minutes", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await expect(
      f.handler.execute(
        { ...f.button, user: { id: "other" } } as unknown as ModalSubmitInteraction,
        undefined!,
      ),
    ).rejects.toThrow("another user");
    await expect(
      f.handler.execute(
        { ...f.button, guild: { ...f.guild, id: "other" } } as unknown as ModalSubmitInteraction,
        undefined!,
      ),
    ).rejects.toThrow("another user or server");
    await expect(
      f.handler.execute(
        { ...f.button, message: { id: "other" } } as unknown as ModalSubmitInteraction,
        undefined!,
      ),
    ).rejects.toThrow("This preview is unavailable. Run /reaction-roles again");
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    await expect(
      f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("expired");
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("consumes the draft even if the final confirmation cannot be delivered", async () => {
    const f = await setup();
    await f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!);
    f.button.customId = `reaction-roles:validate:${f.draftId}`;
    f.interaction.editReply.mockRejectedValueOnce(new Error("reply unavailable"));
    await expect(
      f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("reply unavailable");
    await expect(
      f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("expired");
    expect(f.channel.send).toHaveBeenCalledOnce();
  });
  it("rejects duplicate validation while publication is in progress", async () => {
    vi.useFakeTimers();
    const f = await setup();
    await f.handler.execute(f.entry as unknown as ModalSubmitInteraction, undefined!);
    f.button.customId = `reaction-roles:validate:${f.draftId}`;
    const publishing = f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!);
    await expect(
      f.handler.execute(f.button as unknown as ModalSubmitInteraction, undefined!),
    ).rejects.toThrow("already being published");
    await publishing;
    expect(f.channel.send).toHaveBeenCalledOnce();
  });
});

describe("reaction role clicks", () => {
  it("adds on first click, removes on next, and clears both user reactions", async () => {
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    await handle(f.click, f.actor);
    expect(f.roles.add).toHaveBeenCalledOnce();
    await handle(f.click, f.actor);
    expect(f.roles.remove).toHaveBeenCalledOnce();
    expect(f.reaction.users.remove).toHaveBeenCalledTimes(2);
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: ids.user, force: true });
  });
  it("toggles permission-bearing roles, including Administrator, while retaining hierarchy checks", async () => {
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    f.role.permissions.bitfield = P.Administrator;
    await handle(f.click, f.actor);
    expect(f.roles.add).toHaveBeenCalledOnce();
    await handle(f.click, f.actor);
    expect(f.roles.remove).toHaveBeenCalledOnce();
    vi.spyOn(console, "error").mockImplementation(() => {});
    f.highest.comparePositionTo.mockReturnValue(0);
    await handle(f.click, f.actor);
    expect(f.roles.add).toHaveBeenCalledOnce();
    expect(f.reaction.users.remove).toHaveBeenCalledTimes(3);
  });
  it("removes unconfigured reactions without changing roles", async () => {
    const f = fixture();
    f.reaction.emoji.name = "🎲";
    await createReactionRoleRuntime(f.store)(f.click, f.actor);
    expect(f.reaction.users.remove).toHaveBeenCalledWith(ids.user);
    expect(f.roles.add).not.toHaveBeenCalled();
    expect(f.roles.remove).not.toHaveBeenCalled();
  });
  it("ignores bots and unrelated messages", async () => {
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    f.user.bot = true;
    await handle(f.click, f.actor);
    expect(f.store.get).not.toHaveBeenCalled();
    f.user.bot = false;
    f.store.get.mockResolvedValueOnce(null);
    await handle(f.click, f.actor);
    expect(f.reaction.users.remove).not.toHaveBeenCalled();
  });
  it("deduplicates simultaneous clicks so a role isn't immediately toggled back", async () => {
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    await Promise.all([handle(f.click, f.actor), handle(f.click, f.actor)]);
    expect(f.roles.add).toHaveBeenCalledOnce();
    expect(f.roles.remove).not.toHaveBeenCalled();
    expect(f.reaction.users.remove).toHaveBeenCalledOnce();
  });
  it("rechecks role safety and clears clicks even when assignment fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    f.role.managed = true;
    await handle(f.click, f.actor);
    expect(f.roles.add).not.toHaveBeenCalled();
    f.role.managed = false;
    f.roles.add.mockRejectedValueOnce(new Error("forbidden"));
    await handle(f.click, f.actor);
    expect(f.reaction.users.remove).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(2);
  });
  it("fetches uncached messages after restart using the persisted mapping", async () => {
    const f = fixture();
    const fetch = vi.fn(async () => f.message);
    const partial = { ...f.reaction, message: { ...f.message, partial: true, fetch } };
    await createReactionRoleRuntime(f.store)(partial as unknown as MessageReaction, f.actor);
    expect(fetch).toHaveBeenCalledOnce();
    expect(f.roles.add).toHaveBeenCalledOnce();
    await createReactionRoleRuntime(f.store)(partial as unknown as MessageReaction, f.actor);
    expect(f.roles.remove).toHaveBeenCalledOnce();
  });
  it("serializes different reactions by the same member", async () => {
    const f = fixture();
    f.store.get.mockResolvedValue({
      messageId: f.message.id,
      guildId: ids.guild,
      channelId: ids.channel,
      mappings: [...mappings, { emoji: "🎲", key: "🎲", roleId: ids.role }],
    });
    const second = { ...f.reaction, emoji: { id: null, name: "🎲" } };
    const handle = createReactionRoleRuntime(f.store);
    await Promise.all([
      handle(f.click, f.actor),
      handle(second as unknown as MessageReaction, f.actor),
    ]);
    expect(f.roles.add).toHaveBeenCalledOnce();
    expect(f.roles.remove).toHaveBeenCalledOnce();
    expect(f.roles.add.mock.invocationCallOrder[0]).toBeLessThan(
      f.roles.remove.mock.invocationCallOrder[0]!,
    );
    expect(f.roles.cache.has(ids.role)).toBe(false);
  });
  it("ignores mismatched guild, channel and message author", async () => {
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    f.store.get.mockResolvedValueOnce({
      messageId: f.message.id,
      guildId: "other",
      channelId: ids.channel,
      mappings,
    });
    await handle(f.click, f.actor);
    f.store.get.mockResolvedValueOnce({
      messageId: f.message.id,
      guildId: ids.guild,
      channelId: "other",
      mappings,
    });
    await handle(f.click, f.actor);
    f.message.author.id = "other";
    await handle(f.click, f.actor);
    expect(f.roles.add).not.toHaveBeenCalled();
    expect(f.reaction.users.remove).not.toHaveBeenCalled();
  });
  it("does not toggle when missing reset permissions and contains removal failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture();
    const handle = createReactionRoleRuntime(f.store);
    f.permissions.has.mockReturnValue(false);
    await handle(f.click, f.actor);
    expect(f.roles.add).not.toHaveBeenCalled();
    f.permissions.has.mockReturnValue(true);
    f.reaction.users.remove.mockRejectedValueOnce(new Error("reset failed"));
    await handle(f.click, f.actor);
    expect(f.roles.add).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledTimes(2);
  });
  it("registers only reaction-add events, never treating removal as another toggle", () => {
    const f = fixture();
    const on = vi.fn();
    registerReactionRoleRuntime({ on } as unknown as Client, f.store);
    expect(on).toHaveBeenCalledExactlyOnceWith(Events.MessageReactionAdd, expect.any(Function));
  });
});

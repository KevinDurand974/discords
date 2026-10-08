import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ComponentType,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { commands, componentHandlers } from "@/core/command-registry.ts";
import { postCommand } from "./post.command.ts";
import { createPostModal, postComponentHandler } from "./post-modal.ts";
import { createPostMessage } from "./post-message.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function fixture(type: ChannelType = ChannelType.GuildText) {
  const member = { id: "user" };
  const bot = { id: "bot" };
  const channel = {
    id: "destination",
    guildId: "guild",
    type,
    archived: false,
    locked: false,
    isThread: () =>
      [
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
        ChannelType.AnnouncementThread,
      ].includes(type),
    isSendable: () => true,
    members: { fetch: vi.fn(async (id: string) => ({ id })) },
    permissionsFor: vi.fn(
      (_actor: { id: string }) =>
        new PermissionsBitField([P.ViewChannel, P.SendMessages, P.SendMessagesInThreads]),
    ),
    send: vi.fn(async (_message: unknown) => {}),
  };
  const interaction = {
    inGuild: () => true,
    guildId: "guild",
    user: member,
    guild: {
      channels: { fetch: vi.fn(async () => channel) },
      members: {
        fetch: vi.fn(async () => member),
        fetchMe: vi.fn(async () => bot),
      },
    },
    channel,
    channelId: "destination",
    customId: "post:create:guild:user",
    isModalSubmit: () => true,
    fields: {
      getTextInputValue: vi.fn((id: string): string =>
        id === "title" ? "Title" : "First---Second",
      ),
      getSelectedChannels: vi.fn(() => new Collection([[channel.id, { id: channel.id }]])),
    },
    showModal: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    interaction,
    channel,
    execute: () => postComponentHandler.execute(interaction as unknown as ModalSubmitInteraction),
  };
}

describe("post rendering", () => {
  it("renders a heading and native dividers without content, embeds or mention notifications", () => {
    const message = createPostMessage("Title", " First --- Second\n---\nThird ");
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.allowedMentions).toEqual({ parse: [] });
    expect(message).not.toHaveProperty("content");
    expect(message).not.toHaveProperty("embeds");
    const children = message.components[0]!.toJSON().components;
    expect(children.map((child) => child.type)).toEqual([
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
      ComponentType.Separator,
      ComponentType.TextDisplay,
    ]);
    expect(children[0]).toMatchObject({ content: "# Title\n\nFirst" });
    expect(children[1]).toMatchObject({ divider: true });
    expect(children[4]).toMatchObject({ content: "Third" });
  });
  it("handles empty sections without empty text displays", () => {
    const children = createPostMessage("Title", "---Body------").components[0]!.toJSON().components;
    expect(children.filter((c) => c.type === ComponentType.TextDisplay)).toHaveLength(2);
    expect(children.filter((c) => c.type === ComponentType.Separator)).toHaveLength(3);
  });
  it("caps components while preserving excess delimiters and text", () => {
    const body = Array.from({ length: 30 }, (_, i) => `Section ${i}`).join("---");
    const children = createPostMessage("Title", body).components[0]!.toJSON().components;
    expect(children).toHaveLength(39);
    expect(children.filter((c) => c.type === ComponentType.Separator)).toHaveLength(19);
    expect(children.at(-1)).toMatchObject({
      content: expect.stringContaining("Section 19---Section 20"),
    });
    expect(children.at(-1)).toMatchObject({ content: expect.stringContaining("Section 29") });
  });
  it("escapes title Markdown but preserves post Markdown", () => {
    const children = createPostMessage("**Title**", "**Body**").components[0]!.toJSON().components;
    expect(children[0]).toMatchObject({ content: "# \\*\\*Title\\*\\*\n\n**Body**" });
  });
  it.each([
    ["", "Body"],
    ["x".repeat(101), "Body"],
    ["A\nB", "Body"],
    ["Title", " "],
    ["Title", "---\n---"],
    ["Title", "x".repeat(4001)],
  ])("rejects invalid input", (title, body) => {
    expect(() => createPostMessage(title, body)).toThrow();
  });
  it("enforces the aggregate rendered text limit", () => {
    expect(() => createPostMessage("T", "x".repeat(3995))).not.toThrow();
    expect(() => createPostMessage("T", "x".repeat(3996))).toThrow("too long together");
  });
});

describe("/post", () => {
  it("is registered with its component handler and no slash options", () => {
    expect(commands).toContain(postCommand);
    expect(componentHandlers).toContain(postComponentHandler);
    expect(postCommand.data.toJSON()).toMatchObject({
      name: "post",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: null,
    });
    expect(postCommand.data.toJSON().options ?? []).toEqual([]);
  });
  it("opens three fields in order and defaults the channel selector to the current channel", async () => {
    const f = fixture();
    await postCommand.execute(f.interaction as unknown as ChatInputCommandInteraction);
    const modal = createPostModal(f.interaction as unknown as ChatInputCommandInteraction).toJSON();
    expect(f.interaction.showModal).toHaveBeenCalledOnce();
    expect(modal.custom_id).toBe("post:create:guild:user");
    expect(modal.components).toHaveLength(3);
    expect(modal.components[0]).toMatchObject({
      component: { custom_id: "title", style: 1, required: true },
    });
    expect(modal.components[1]).toMatchObject({
      component: { custom_id: "body", style: 2, required: true },
    });
    expect(modal.components[2]).toMatchObject({
      component: { custom_id: "channel", default_values: [{ id: "destination", type: "channel" }] },
    });
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });
  it("leaves unsupported invocation channels unselected", () => {
    const f = fixture(ChannelType.GuildForum);
    const modal = createPostModal(f.interaction as unknown as ChatInputCommandInteraction).toJSON();
    expect(modal.components[2]).toMatchObject({ component: { custom_id: "channel" } });
    expect(JSON.stringify(modal.components[2])).not.toContain("default_values");
  });
  it("publishes to the selected destination and deletes only the private confirmation after 10 seconds", async () => {
    const f = fixture();
    f.interaction.channelId = "invocation";
    await f.execute();
    expect(f.interaction.guild.channels.fetch).toHaveBeenCalledWith("destination");
    expect(f.channel.send).toHaveBeenCalledOnce();
    expect(f.channel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      }),
    );
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "Post published in <#destination>.",
      allowedMentions: { parse: [] },
    });
    expect(f.channel.send.mock.invocationCallOrder[0]).toBeLessThan(
      f.interaction.editReply.mock.invocationCallOrder[0]!,
    );
    await vi.advanceTimersByTimeAsync(9999);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it.each([
    "user",
    "bot",
    "other-guild",
    "dm",
    "invalid-body",
    "missing-channel",
    "unsupported",
    "unsendable",
    "permissions",
  ])("refuses %s without publishing", async (kind) => {
    const f = fixture();
    if (kind === "user") f.interaction.customId = "post:create:guild:other";
    if (kind === "bot" || kind === "permissions")
      f.channel.permissionsFor.mockImplementation(
        (actor) =>
          new PermissionsBitField(
            actor.id === (kind === "bot" ? "bot" : "user") ? [] : [P.ViewChannel, P.SendMessages],
          ),
      );
    if (kind === "other-guild") f.channel.guildId = "other";
    if (kind === "dm") f.interaction.inGuild = () => false;
    if (kind === "invalid-body") f.interaction.fields.getTextInputValue.mockReturnValue(" ");
    if (kind === "missing-channel")
      f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    if (kind === "unsupported") f.channel.type = ChannelType.GuildForum;
    if (kind === "unsendable") f.channel.isSendable = () => false;
    await expect(f.execute()).rejects.toThrow();
    expect(f.channel.send).not.toHaveBeenCalled();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });
  it.each(["archived", "locked"] as const)("rejects %s threads", async (state) => {
    const f = fixture(ChannelType.PublicThread);
    f.channel[state] = true;
    await expect(f.execute()).rejects.toThrow("archived or locked");
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("requires thread-send permissions instead of ordinary Send Messages", async () => {
    const f = fixture(ChannelType.PublicThread);
    f.channel.permissionsFor.mockReturnValue(
      new PermissionsBitField([P.ViewChannel, P.SendMessagesInThreads]),
    );
    await f.execute();
    expect(f.channel.send).toHaveBeenCalledOnce();
  });
  it("requires private thread membership for both caller and bot", async () => {
    const f = fixture(ChannelType.PrivateThread);
    f.channel.members.fetch.mockRejectedValue(new Error("Not a member"));
    await expect(f.execute()).rejects.toThrow("members of the private thread");
    expect(f.channel.send).not.toHaveBeenCalled();
  });
  it("allows Manage Threads to bypass private thread membership", async () => {
    const f = fixture(ChannelType.PrivateThread);
    f.channel.permissionsFor.mockReturnValue(
      new PermissionsBitField([P.ViewChannel, P.SendMessagesInThreads, P.ManageThreads]),
    );
    await f.execute();
    expect(f.channel.members.fetch).not.toHaveBeenCalled();
    expect(f.channel.send).toHaveBeenCalledOnce();
  });
  it("does not confirm success or start cleanup when publication fails", async () => {
    const f = fixture();
    f.channel.send.mockRejectedValue(new Error("Discord unavailable"));
    await expect(f.execute()).rejects.toThrow("Discord unavailable");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

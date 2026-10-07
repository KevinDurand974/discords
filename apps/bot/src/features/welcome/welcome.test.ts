import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelType,
  Collection,
  ContainerBuilder,
  Events,
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type ChatInputCommandInteraction,
  type GuildMember,
  type MessageCreateOptions,
  type ModalSubmitInteraction,
} from "discord.js";
import {
  createWelcomeModal,
  resetWelcomeSettings,
  saveWelcomeSettings,
  welcomeCommand,
} from "./welcome.command.ts";
import {
  registerWelcomeRuntime,
  renderWelcomeMessage,
  sendWelcomeMessage,
} from "./welcome-runtime.ts";
import type { WelcomeStore } from "./welcome-repository.ts";
import { DEFAULT_ARRIVAL_MESSAGE } from "./welcome-messages.ts";

const settings = {
  guildId: "guild",
  channelId: "channel",
  arrivalMessage: "Hello {user}, welcome to {server}!",
  departureMessage: "Bye {user} from {server}.",
};
function fixture() {
  const send = vi.fn(async (_options: MessageCreateOptions) => {});
  const has = vi.fn(() => true);
  const channel = {
    id: "channel",
    type: ChannelType.GuildText,
    send,
    delete: vi.fn(async () => {}),
    permissionsFor: () => ({ has }),
  };
  const guild = {
    id: "guild",
    name: "My server",
    memberCount: 42,
    channels: { fetch: vi.fn(async () => channel), create: vi.fn(async () => channel) },
    members: {
      fetchMe: vi.fn(async () => ({ id: "bot", permissions: { has: vi.fn(() => true) } })),
    },
  };
  const member = { id: "member", user: { username: "User" }, guild } as unknown as GuildMember;
  const store = {
    get: vi.fn(async () => settings),
    save: vi.fn(async () => {}),
    reset: vi.fn(async (_guildId: string) => {}),
  } satisfies WelcomeStore;
  const interaction = {
    inGuild: () => true,
    guild,
    guildId: guild.id,
    user: { id: "admin" },
    memberPermissions: { has: vi.fn(() => true) },
    customId: "welcome:setup:v2:admin:guild",
    fields: {
      getSelectedChannels: vi.fn(() => new Collection([[channel.id, channel]])),
      getTextInputValue: vi.fn((id: string) =>
        id === "welcome-channel-name"
          ? "welcome"
          : id === "arrival-message"
            ? settings.arrivalMessage
            : settings.departureMessage,
      ),
    },
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    send,
    has,
    channel,
    guild,
    member,
    store,
    interaction,
    submit: interaction as unknown as ModalSubmitInteraction,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("welcome setup", () => {
  it("keeps default values attached to their labeled fields with unique component IDs", () => {
    const modal = createWelcomeModal("admin", "guild").toJSON();
    const labels = modal.components as {
      id?: number;
      label: string;
      component: { id?: number; custom_id: string; value?: string };
    }[];
    expect(
      labels.map(({ label, component }) => [label, component.custom_id, component.value]),
    ).toEqual([
      ["Existing arrival and departure channel", "welcome-channel", undefined],
      ["New channel name", "welcome-channel-name", "welcome"],
      ["Welcome message", "arrival-message", DEFAULT_ARRIVAL_MESSAGE],
      [
        "Departure message",
        "departure-message",
        "👋 **{user} has left the server.**\n\nThanks for being part of the community. See you around!",
      ],
    ]);
    const ids = labels
      .flatMap((label) => [label.id, label.component.id])
      .filter((id) => id !== undefined);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("defines a server-only Manage Server command and four modal fields allowing existing or new channels", () => {
    expect(welcomeCommand.data.toJSON()).toMatchObject({
      name: "welcome",
      contexts: [0],
      default_member_permissions: String(PermissionFlagsBits.ManageGuild),
      options: [
        { type: 1, name: "setup" },
        { type: 1, name: "reset" },
      ],
    });
    const modal = createWelcomeModal("admin", "guild", settings).toJSON();
    expect(modal.custom_id).toBe("welcome:setup:v2:admin:guild");
    expect(modal.components).toHaveLength(4);
    expect(modal.components[0]).toMatchObject({
      component: {
        type: 8,
        required: false,
        min_values: 0,
        channel_types: [ChannelType.GuildText],
        default_values: [{ id: "channel", type: "channel" }],
      },
    });
    expect(modal.components[1]).toMatchObject({
      component: { custom_id: "welcome-channel-name", value: "welcome", required: false },
    });
    expect(modal.components[2]).toMatchObject({
      component: { value: settings.arrivalMessage, max_length: 1000 },
    });
    expect(modal.components[3]).toMatchObject({ component: { value: settings.departureMessage } });
  });
  it("rejects old modal layouts instead of accepting stale field mappings", async () => {
    const f = fixture();
    f.interaction.customId = "welcome:setup:admin:guild";
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow(
      "Run /welcome setup again",
    );
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it("saves settings and privately confirms, deleting only the confirmation after ten seconds", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await saveWelcomeSettings(f.submit, f.store);
    expect(f.store.save).toHaveBeenCalledWith(settings);
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
    expect(f.interaction.editReply).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("rejects missing permissions and forms from another user", async () => {
    const f = fixture();
    f.interaction.memberPermissions.has.mockReturnValue(false);
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("Manage Server");
    f.interaction.memberPermissions.has.mockReturnValue(true);
    f.interaction.customId = "welcome:setup:v2:someone-else:guild";
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("another user or server");
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it("rejects inaccessible channels and blank templates before saving", async () => {
    const f = fixture();
    f.has.mockReturnValue(false);
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow(
      "View Channel and Send Messages",
    );
    f.has.mockReturnValue(true);
    f.interaction.fields.getTextInputValue.mockReturnValue("  ");
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("between 1 and 1000");
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it("does not confirm success when persistence fails", async () => {
    const f = fixture();
    f.store.save.mockRejectedValue(new Error("database offline"));
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("database offline");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
  it("creates a named text channel when no existing channel is selected", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.interaction.fields.getTextInputValue.mockImplementation((id) =>
      id === "welcome-channel-name"
        ? "arrivals"
        : id === "arrival-message"
          ? settings.arrivalMessage
          : settings.departureMessage,
    );
    await saveWelcomeSettings(f.submit, f.store);
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.guild.channels.create).toHaveBeenCalledWith({
      name: "arrivals",
      type: ChannelType.GuildText,
      permissionOverwrites: [
        { id: "bot", allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
      reason: expect.any(String),
    });
    expect(f.store.save).toHaveBeenCalledWith(settings);
  });
  it("defaults an empty new channel name to welcome", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.interaction.fields.getTextInputValue.mockImplementation((id) =>
      id === "welcome-channel-name" ? " " : "Hi",
    );
    await saveWelcomeSettings(f.submit, f.store);
    expect(f.guild.channels.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: "welcome" }),
    );
  });
  it("requires Manage Channels for caller and bot only when creating", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.interaction.memberPermissions.has.mockImplementation(
      (permission?: unknown) => permission !== PermissionFlagsBits.ManageChannels,
    );
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow(
      "You need Manage Channels",
    );
    f.interaction.memberPermissions.has.mockReturnValue(true);
    const bot = await f.guild.members.fetchMe();
    bot.permissions.has.mockReturnValue(false);
    f.guild.members.fetchMe.mockResolvedValue(bot);
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("I need Manage Channels");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    f.interaction.fields.getSelectedChannels.mockReturnValue(
      new Collection([[f.channel.id, f.channel]]),
    );
    await saveWelcomeSettings(f.submit, f.store);
    expect(f.store.save).toHaveBeenCalledOnce();
  });
  it("validates messages before creating a channel", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.interaction.fields.getTextInputValue.mockReturnValue(" ");
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("between 1 and 1000");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
  });
  it("removes only a newly created channel when saving fails", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.store.save.mockRejectedValue(new Error("offline"));
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("offline");
    expect(f.channel.delete).toHaveBeenCalledOnce();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
  it("reports failed cleanup without claiming setup succeeded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.store.save.mockRejectedValue(new Error("offline"));
    f.channel.delete.mockRejectedValue(new Error("no permission"));
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow(
      "delete the new channel manually",
    );
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
  it("rejects separator-only or excessive sections before creating a channel", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.interaction.fields.getTextInputValue.mockImplementation(() => "---\n---");
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("must contain text");
    f.interaction.fields.getTextInputValue.mockImplementation(() =>
      Array(21).fill("text").join("\n---\n"),
    );
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("Too many");
    expect(f.guild.channels.create).not.toHaveBeenCalled();
    expect(f.store.save).not.toHaveBeenCalled();
  });
  it("does not save settings when channel creation fails", async () => {
    const f = fixture();
    f.interaction.fields.getSelectedChannels.mockReturnValue(new Collection());
    f.guild.channels.create.mockRejectedValue(new Error("creation failed"));
    await expect(saveWelcomeSettings(f.submit, f.store)).rejects.toThrow("creation failed");
    expect(f.store.save).not.toHaveBeenCalled();
  });
});

describe("welcome reset", () => {
  it("removes this server's configuration, keeps the channel, and privately confirms", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await resetWelcomeSettings(f.interaction as unknown as ChatInputCommandInteraction, f.store);
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.store.reset).toHaveBeenCalledExactlyOnceWith("guild");
    expect(f.store.save).not.toHaveBeenCalled();
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("disabled"),
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("succeeds repeatedly even when no configuration exists", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const interaction = f.interaction as unknown as ChatInputCommandInteraction;
    await resetWelcomeSettings(interaction, f.store);
    await resetWelcomeSettings(interaction, f.store);
    expect(f.store.reset).toHaveBeenCalledTimes(2);
    expect(f.store.get).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledTimes(2);
  });
  it("rejects missing Manage Server permissions or DMs before removing settings", async () => {
    const f = fixture();
    const interaction = f.interaction as unknown as ChatInputCommandInteraction;
    f.interaction.memberPermissions.has.mockReturnValue(false);
    await expect(resetWelcomeSettings(interaction, f.store)).rejects.toThrow("Manage Server");
    f.interaction.inGuild = () => false;
    await expect(resetWelcomeSettings(interaction, f.store)).rejects.toThrow("in a server");
    expect(f.store.reset).not.toHaveBeenCalled();
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
  });
  it("does not claim success if database deletion fails", async () => {
    const f = fixture();
    f.store.reset.mockRejectedValueOnce(new Error("offline"));
    await expect(
      resetWelcomeSettings(f.interaction as unknown as ChatInputCommandInteraction, f.store),
    ).rejects.toThrow("offline");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.channel.delete).not.toHaveBeenCalled();
  });
});

describe("membership notifications", () => {
  it("sends arrival and departure templates to the persisted channel, limiting mentions", async () => {
    const f = fixture();
    await sendWelcomeMessage(f.member, true, f.store);
    await sendWelcomeMessage(f.member, false, f.store);
    expect(f.store.get).toHaveBeenCalledWith("guild");
    expect(f.send).toHaveBeenNthCalledWith(1, {
      flags: MessageFlags.IsComponentsV2,
      components: [expect.any(ContainerBuilder)],
      allowedMentions: { parse: [], users: ["member"] },
    });
    expect(f.send).toHaveBeenNthCalledWith(2, {
      flags: MessageFlags.IsComponentsV2,
      components: [expect.any(ContainerBuilder)],
      allowedMentions: { parse: [], users: [] },
    });
    const arrival = f.send.mock.calls[0]![0];
    const departure = f.send.mock.calls[1]![0];
    expect(arrival).not.toHaveProperty("content");
    expect(arrival).not.toHaveProperty("embeds");
    expect(departure).not.toHaveProperty("content");
    expect(departure).not.toHaveProperty("embeds");
    expect((arrival.components![0] as ContainerBuilder).toJSON()).toMatchObject({
      type: 17,
      accent_color: 0x57f287,
      components: [{ type: 10, content: "Hello <@member>, welcome to My server!" }],
    });
    expect((departure.components![0] as ContainerBuilder).toJSON()).toMatchObject({
      type: 17,
      accent_color: 0x95a5a6,
      components: [{ type: 10, content: "Bye User from My server." }],
    });
  });
  it("sends the new welcome template with native separators and member count", async () => {
    const f = fixture();
    f.store.get.mockResolvedValueOnce({ ...settings, arrivalMessage: DEFAULT_ARRIVAL_MESSAGE });
    await sendWelcomeMessage(f.member, true, f.store);
    const payload = f.send.mock.calls[0]![0];
    const container = (payload.components![0] as ContainerBuilder).toJSON();
    expect(container.components).toHaveLength(5);
    expect(container.components.map((component) => component.type)).toEqual([10, 14, 10, 14, 10]);
    expect(container.components[0]).toMatchObject({
      content: expect.stringContaining("# 👋 Welcome to My server!\n\nHey **<@member>**, welcome!"),
    });
    expect(container.components[4]).toMatchObject({
      content: "✨ You're our **42th member**.  \nEnjoy your stay!",
    });
    expect(payload.allowedMentions).toEqual({ parse: [], users: ["member"] });
  });
  it("expands memberCount on arrivals and departures without recursively expanding names", () => {
    const f = fixture();
    f.guild.name = "{memberCount}";
    expect(
      renderWelcomeMessage("{server}: {memberCount} {memberCount} {user}", f.member, true),
    ).toBe("{memberCount}: 42 42 <@member>");
    f.guild.memberCount = 41;
    expect(renderWelcomeMessage("{memberCount} {user}", f.member, false)).toBe("41 User");
  });
  it("does nothing for unconfigured servers or missing channels", async () => {
    const f = fixture();
    f.store.get.mockResolvedValueOnce(null as unknown as typeof settings);
    await sendWelcomeMessage(f.member, true, f.store);
    expect(f.guild.channels.fetch).not.toHaveBeenCalled();
    f.guild.channels.fetch.mockResolvedValueOnce(
      null as unknown as Awaited<ReturnType<typeof f.guild.channels.fetch>>,
    );
    await sendWelcomeMessage(f.member, false, f.store);
    expect(f.send).not.toHaveBeenCalled();
  });
  it("contains database and Discord failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = fixture();
    f.store.get.mockRejectedValueOnce(new Error("offline"));
    await expect(sendWelcomeMessage(f.member, true, f.store)).resolves.toBeUndefined();
    f.send.mockRejectedValueOnce(new Error("missing permissions"));
    await expect(sendWelcomeMessage(f.member, false, f.store)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(2);
  });
  it("replaces placeholders once, escapes names, and respects Discord's message limit", () => {
    const f = fixture();
    f.guild.name = "**{user}**";
    expect(renderWelcomeMessage("{server} {user}", f.member, true)).toBe(
      "\\*\\*{user}\\*\\* <@member>",
    );
    expect(renderWelcomeMessage("{server}".repeat(1000), f.member, true).length).toBe(2000);
  });
  it("registers both membership event listeners", () => {
    const f = fixture();
    const on = vi.fn();
    registerWelcomeRuntime({ on } as unknown as Client, f.store);
    expect(on).toHaveBeenCalledWith(Events.GuildMemberAdd, expect.any(Function));
    expect(on).toHaveBeenCalledWith(Events.GuildMemberRemove, expect.any(Function));
  });
});

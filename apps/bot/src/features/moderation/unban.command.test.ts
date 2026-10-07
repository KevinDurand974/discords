import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  DiscordAPIError,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { unbanCommand } from "./unban.command.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function fixture(id = "123456789012345678") {
  const member = { permissions: new PermissionsBitField(P.BanMembers) };
  const bot = { permissions: new PermissionsBitField(P.BanMembers) };
  const guild = {
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
    bans: { remove: vi.fn(async () => {}) },
  };
  const interaction = {
    inGuild: () => true,
    guild: guild as typeof guild | null,
    user: { id: "moderator" },
    options: { getString: vi.fn(() => id) },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    member,
    bot,
    guild,
    interaction,
    run: () => unbanCommand.execute(interaction as unknown as ChatInputCommandInteraction),
  };
}

describe("/unban", () => {
  it("deletes the successful acknowledgment after 10 seconds", async () => {
    const f = fixture();
    await f.run();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("registers a guild-only Ban Members command with a required string ID", () => {
    expect(commands).toContain(unbanCommand);
    expect(unbanCommand.data.toJSON()).toMatchObject({
      name: "unban",
      contexts: [InteractionContextType.Guild],
      default_member_permissions: P.BanMembers.toString(),
      options: [{ name: "user-id", type: ApplicationCommandOptionType.String, required: true }],
    });
  });
  it.each(["123456789012345678", "18446744073709551615", " 123456789012345678 "])(
    "unbans %s with fresh permission checks and a private response",
    async (id) => {
      const f = fixture(id);
      await f.run();
      expect(f.interaction.options.getString).toHaveBeenCalledWith("user-id", true);
      expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
      expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "moderator", force: true });
      expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
      expect(f.guild.bans.remove).toHaveBeenCalledExactlyOnceWith(
        id.trim(),
        "Unban requested by moderator",
      );
      expect(f.interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining(id.trim()),
        allowedMentions: { parse: [] },
      });
    },
  );
  it.each([
    "",
    "123",
    "alice",
    "<@123456789012345678>",
    "-123456789012345678",
    "123456789012345678x",
    "18446744073709551616",
    "012345678901234567",
  ])("rejects invalid ID %s without Discord mutations", async (id) => {
    const f = fixture(id);
    await expect(f.run()).rejects.toThrow("valid Discord user ID");
    expect(f.guild.bans.remove).not.toHaveBeenCalled();
    expect(f.guild.members.fetch).not.toHaveBeenCalled();
  });
  it.each(["member", "bot"] as const)(
    "requires Ban Members for the %s even if command permissions are overridden",
    async (actor) => {
      const f = fixture();
      f[actor].permissions.remove(P.BanMembers);
      await expect(f.run()).rejects.toThrow("Ban Members");
      expect(f.guild.bans.remove).not.toHaveBeenCalled();
      expect(f.interaction.editReply).not.toHaveBeenCalled();
    },
  );
  it("allows administrators", async () => {
    const f = fixture();
    f.member.permissions = new PermissionsBitField(P.Administrator);
    f.bot.permissions = new PermissionsBitField(P.Administrator);
    await f.run();
    expect(f.guild.bans.remove).toHaveBeenCalledOnce();
  });
  it.each(["dm", "missing-guild"])("rejects %s", async (kind) => {
    const f = fixture();
    if (kind === "dm") f.interaction.inGuild = () => false;
    else f.interaction.guild = null;
    await expect(f.run()).rejects.toThrow("server");
    expect(f.guild.bans.remove).not.toHaveBeenCalled();
  });
  it("explains when the target is not banned", async () => {
    const f = fixture();
    f.guild.bans.remove.mockRejectedValue(
      new DiscordAPIError(
        { message: "Unknown Ban", code: 10026 },
        10026,
        404,
        "DELETE",
        "https://discord.com/api",
        {},
      ),
    );
    await expect(f.run()).rejects.toThrow("not banned from this server");
    expect(vi.getTimerCount()).toBe(0);
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
  it.each(["permission changed", "REST unavailable"])(
    "does not report success on %s",
    async (message) => {
      const f = fixture();
      f.guild.bans.remove.mockRejectedValue(new Error(message));
      await expect(f.run()).rejects.toThrow(message);
      expect(f.interaction.editReply).not.toHaveBeenCalled();
    },
  );
});

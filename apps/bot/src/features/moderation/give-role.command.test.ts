import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  Collection,
  MessageFlags,
  PermissionFlagsBits as P,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { giveRoleCommand } from "./give-role.command.ts";
import { giveRole } from "./give-role.ts";
import { stripRoleCommand } from "./strip-role.command.ts";

function fixture() {
  const role = {
    id: "role",
    managed: false,
    editable: true,
    permissions: { bitfield: P.Administrator },
  };
  const actor = {
    id: "actor",
    permissions: { has: vi.fn(() => true) },
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const bot = {
    permissions: { has: vi.fn(() => true) },
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const target = {
    roles: {
      cache: new Collection<string, typeof role>(),
      add: vi.fn(async () => {}),
      remove: vi.fn(async () => {}),
    },
  };
  const guild = {
    id: "guild",
    ownerId: "owner",
    roles: { fetch: vi.fn(async (): Promise<typeof role | null> => role) },
    members: {
      fetch: vi.fn(async ({ user }: { user: string; force: boolean }) =>
        user === actor.id ? actor : target,
      ),
      fetchMe: vi.fn(async () => bot),
    },
  };
  const interaction = {
    guild,
    user: { id: actor.id },
    inGuild: vi.fn(() => true),
    options: { getRole: vi.fn(() => ({ id: role.id })), getUser: vi.fn(() => ({ id: "target" })) },
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    actor,
    bot,
    role,
    target,
    guild,
    interaction,
    submit: interaction as unknown as ChatInputCommandInteraction,
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("strip role command", () => {
  it("registers required role/user options with the same moderator permissions", () => {
    expect(commands).toContain(stripRoleCommand);
    expect(stripRoleCommand.data.toJSON()).toMatchObject({
      name: "strip-role",
      contexts: [0],
      default_member_permissions: String(P.ManageRoles),
      options: [
        { name: "role", type: ApplicationCommandOptionType.Role, required: true },
        { name: "user", type: ApplicationCommandOptionType.User, required: true },
      ],
    });
  });
  it("removes a permission-bearing role with an audit reason and a temporary private confirmation", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.target.roles.cache.set(f.role.id, f.role);
    await stripRoleCommand.execute(f.submit);
    expect(f.interaction.options.getRole).toHaveBeenCalledWith("role", true);
    expect(f.interaction.options.getUser).toHaveBeenCalledWith("user", true);
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "actor", force: true });
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "target", force: true });
    expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
    expect(f.guild.roles.fetch).toHaveBeenCalledWith("role", { force: true });
    expect(f.target.roles.remove).toHaveBeenCalledExactlyOnceWith(
      f.role,
      "Role removed by actor via /strip-role",
    );
    expect(f.target.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "Removed <@&role> from <@target>.",
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("does not modify roles when the target lacks the selected role", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await stripRoleCommand.execute(f.submit);
    expect(f.target.roles.remove).not.toHaveBeenCalled();
    expect(f.target.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "<@target> does not have <@&role>.",
      allowedMentions: { parse: [] },
    });
  });
  it.each(["actor", "bot"] as const)("rejects missing Manage Roles for %s", async (who) => {
    const f = fixture();
    f[who].permissions.has.mockReturnValue(false);
    await expect(stripRoleCommand.execute(f.submit)).rejects.toThrow("Manage Roles");
    expect(f.target.roles.remove).not.toHaveBeenCalled();
  });
  it.each([
    "dm",
    "everyone",
    "managed",
    "uneditable",
    "bot-hierarchy",
    "actor-hierarchy",
    "deleted-role",
  ])("refuses unsafe %s removal", async (kind) => {
    const f = fixture();
    f.target.roles.cache.set(f.role.id, f.role);
    if (kind === "dm") f.interaction.inGuild.mockReturnValue(false);
    if (kind === "everyone") f.role.id = f.guild.id;
    if (kind === "managed") f.role.managed = true;
    if (kind === "uneditable") f.role.editable = false;
    if (kind === "bot-hierarchy") f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    if (kind === "actor-hierarchy") f.actor.roles.highest.comparePositionTo.mockReturnValue(0);
    if (kind === "deleted-role") f.guild.roles.fetch.mockResolvedValueOnce(null);
    await expect(stripRoleCommand.execute(f.submit)).rejects.toThrow();
    expect(f.target.roles.remove).not.toHaveBeenCalled();
  });
  it("exempts the server owner from caller hierarchy but still enforces bot hierarchy", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.target.roles.cache.set(f.role.id, f.role);
    f.guild.ownerId = f.actor.id;
    f.actor.roles.highest.comparePositionTo.mockReturnValue(-1);
    await stripRoleCommand.execute(f.submit);
    expect(f.target.roles.remove).toHaveBeenCalledOnce();
    f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    await expect(stripRoleCommand.execute(f.submit)).rejects.toThrow("bot's highest role");
    expect(f.target.roles.remove).toHaveBeenCalledOnce();
  });
  it("preserves removal failures without displaying or deleting a success reply", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.target.roles.cache.set(f.role.id, f.role);
    f.target.roles.remove.mockRejectedValueOnce(new Error("forbidden"));
    await expect(stripRoleCommand.execute(f.submit)).rejects.toThrow("forbidden");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });
});

describe("give role command", () => {
  it("registers a server-only command with two mandatory role/user options, restricted to Manage Roles", () => {
    expect(commands).toContain(giveRoleCommand);
    expect(giveRoleCommand.data.toJSON()).toMatchObject({
      name: "give-role",
      contexts: [0],
      default_member_permissions: String(P.ManageRoles),
      options: [
        { name: "role", type: ApplicationCommandOptionType.Role, required: true },
        { name: "user", type: ApplicationCommandOptionType.User, required: true },
      ],
    });
  });
  it("fetches current members and role, allows permission-bearing roles and assigns with an audit reason", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await giveRole(f.submit);
    expect(f.interaction.options.getRole).toHaveBeenCalledWith("role", true);
    expect(f.interaction.options.getUser).toHaveBeenCalledWith("user", true);
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "actor", force: true });
    expect(f.guild.members.fetch).toHaveBeenCalledWith({ user: "target", force: true });
    expect(f.guild.members.fetchMe).toHaveBeenCalledWith({ force: true });
    expect(f.guild.roles.fetch).toHaveBeenCalledWith("role", { force: true });
    expect(f.target.roles.add).toHaveBeenCalledWith(
      f.role,
      "Role assigned by actor via /give-role",
    );
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "Assigned <@&role> to <@target>.",
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("does not add an already assigned role again", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.target.roles.cache.set(f.role.id, f.role);
    await giveRole(f.submit);
    expect(f.target.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "<@target> already has <@&role>.",
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("rejects use outside a server", async () => {
    const f = fixture();
    f.interaction.inGuild.mockReturnValue(false);
    await expect(giveRole(f.submit)).rejects.toThrow("server");
    expect(f.interaction.deferReply).not.toHaveBeenCalled();
    expect(f.target.roles.add).not.toHaveBeenCalled();
  });
  it.each(["actor", "bot"] as const)(
    "checks current Manage Roles permission for %s",
    async (who) => {
      const f = fixture();
      f[who].permissions.has.mockReturnValue(false);
      await expect(giveRole(f.submit)).rejects.toThrow("Manage Roles");
      expect(f.target.roles.add).not.toHaveBeenCalled();
    },
  );
  it("rejects roles that no longer exist", async () => {
    const f = fixture();
    f.guild.roles.fetch.mockResolvedValueOnce(null);
    await expect(giveRole(f.submit)).rejects.toThrow("no longer exists");
    expect(f.target.roles.add).not.toHaveBeenCalled();
  });
  it.each([
    "everyone",
    "managed",
    "uneditable",
    "bot-equal",
    "bot-higher",
    "actor-equal",
    "actor-higher",
  ])("rejects %s roles", async (kind) => {
    const f = fixture();
    if (kind === "everyone") f.role.id = f.guild.id;
    if (kind === "managed") f.role.managed = true;
    if (kind === "uneditable") f.role.editable = false;
    if (kind.startsWith("bot"))
      f.bot.roles.highest.comparePositionTo.mockReturnValue(kind.endsWith("equal") ? 0 : -1);
    if (kind.startsWith("actor"))
      f.actor.roles.highest.comparePositionTo.mockReturnValue(kind.endsWith("equal") ? 0 : -1);
    await expect(giveRole(f.submit)).rejects.toThrow();
    expect(f.target.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
  it("exempts the server owner only from the actor hierarchy restriction", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.guild.ownerId = f.actor.id;
    f.actor.roles.highest.comparePositionTo.mockReturnValue(-1);
    await giveRole(f.submit);
    expect(f.target.roles.add).toHaveBeenCalledOnce();
    f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    await expect(giveRole(f.submit)).rejects.toThrow("bot's highest role");
    expect(f.target.roles.add).toHaveBeenCalledOnce();
  });
  it("preserves REST failures without displaying or deleting a success response", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.target.roles.add.mockRejectedValueOnce(new Error("forbidden"));
    await expect(giveRole(f.submit)).rejects.toThrow("forbidden");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });
  it("rejects targets who left the server before execution", async () => {
    const f = fixture();
    f.guild.members.fetch
      .mockResolvedValueOnce(f.actor)
      .mockRejectedValueOnce(new Error("Unknown Member"));
    await expect(giveRole(f.submit)).rejects.toThrow("Unknown Member");
    expect(f.target.roles.add).not.toHaveBeenCalled();
  });
});

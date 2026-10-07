import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Collection,
  MessageFlags,
  PermissionsBitField,
  PermissionFlagsBits as P,
  type ButtonInteraction,
} from "discord.js";
import { componentHandlers } from "@/core/command-registry.ts";
import { ruleAcceptanceHandler } from "./rule-acceptance.ts";
import { RULE_ROLE_PERMISSIONS } from "./rule-role.ts";

function fixture() {
  const everyone = {
    id: "100",
    permissions: new PermissionsBitField([P.ViewChannel, P.SendMessages]),
  };
  const role = {
    id: "200",
    managed: false,
    editable: true,
    permissions: new PermissionsBitField(RULE_ROLE_PERMISSIONS),
  };
  const member = {
    id: "300",
    roles: { cache: new Collection<string, unknown>(), add: vi.fn(async () => {}) },
  };
  const bot = {
    permissions: new PermissionsBitField(P.ManageRoles),
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  };
  const guild = {
    id: "100",
    roles: {
      fetch: vi.fn(async (id: string) => (id === "100" ? everyone : (role as typeof role | null))),
    },
    members: { fetch: vi.fn(async () => member), fetchMe: vi.fn(async () => bot) },
  };
  const interaction = {
    isButton: () => true,
    inGuild: () => true,
    guild,
    user: { id: member.id },
    customId: "rule-accept:100:200",
    message: { author: { id: "400" } },
    client: { user: { id: "400" } },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    everyone,
    role,
    member,
    bot,
    guild,
    interaction,
    execute: () => ruleAcceptanceHandler.execute(interaction as unknown as ButtonInteraction),
  };
}

describe("rules acceptance button", () => {
  it("assigns the permissionless marker regardless of @everyone permissions", async () => {
    const f = fixture();
    f.role.permissions = new PermissionsBitField(RULE_ROLE_PERMISSIONS);
    await f.execute();
    expect(f.member.roles.add).toHaveBeenCalledWith(f.role, "Accepted the server rules");
  });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each([false, true])(
    "deletes the acknowledgment only after five seconds (already accepted=%s)",
    async (alreadyAccepted) => {
      const f = fixture();
      if (alreadyAccepted) f.member.roles.cache.set(f.role.id, f.role);
      await f.execute();
      expect(f.interaction.deleteReply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(f.interaction.deleteReply).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
    },
  );

  it("handles an already dismissed or deleted acknowledgment without an unhandled rejection", async () => {
    const f = fixture();
    f.interaction.deleteReply.mockRejectedValue(new Error("Unknown Message"));
    await f.execute();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });

  it("does not schedule deletion if the acknowledgment fails to display", async () => {
    const f = fixture();
    f.interaction.editReply.mockRejectedValue(new Error("Cannot edit"));
    await expect(f.execute()).rejects.toThrow("Cannot edit");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });

  it("registers a persistent handler and gives the role only to the clicking member", async () => {
    expect(componentHandlers).toContain(ruleAcceptanceHandler);
    const f = fixture();
    await f.execute();
    expect(f.interaction.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(f.guild.members.fetch).toHaveBeenCalledWith("300");
    expect(f.guild.roles.fetch).toHaveBeenCalledWith("200", { force: true });
    expect(f.member.roles.add).toHaveBeenCalledExactlyOnceWith(f.role, "Accepted the server rules");
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "Thank you! You have accepted the rules and received the acceptance role.",
      allowedMentions: { parse: [] },
    });
  });

  it("does not reassign a role the member already has", async () => {
    const f = fixture();
    f.member.roles.cache.set(f.role.id, f.role);
    await f.execute();
    expect(f.member.roles.add).not.toHaveBeenCalled();
    expect(f.interaction.editReply).toHaveBeenCalledWith({
      content: "You have already accepted the rules.",
      allowedMentions: { parse: [] },
    });
  });

  it.each(["deleted", "managed", "hierarchy", "privileged", "permissions"])(
    "refuses a %s role or missing bot permissions",
    async (state) => {
      const f = fixture();
      if (state === "deleted") f.guild.roles.fetch.mockResolvedValueOnce(null);
      if (state === "managed") f.role.managed = true;
      if (state === "hierarchy") f.bot.roles.highest.comparePositionTo.mockReturnValue(0);
      if (state === "privileged") f.role.permissions.add(P.ManageGuild);
      if (state === "permissions") f.bot.permissions.remove(P.ManageRoles);
      await expect(f.execute()).rejects.toThrow();
      expect(f.member.roles.add).not.toHaveBeenCalled();
    },
  );

  it.each(["dm", "foreign-guild", "foreign-author", "malformed"])(
    "rejects %s interactions",
    async (state) => {
      const f = fixture();
      if (state === "dm") f.interaction.inGuild = () => false;
      if (state === "foreign-guild") f.interaction.customId = "rule-accept:999:200";
      if (state === "foreign-author") f.interaction.message.author.id = "999";
      if (state === "malformed") f.interaction.customId = "rule-accept:100:200:extra";
      await expect(f.execute()).rejects.toThrow();
      expect(f.member.roles.add).not.toHaveBeenCalled();
    },
  );

  it("reports assignment errors without announcing success", async () => {
    const f = fixture();
    f.member.roles.add.mockRejectedValue(new Error("Cannot assign"));
    await expect(f.execute()).rejects.toThrow("Cannot assign");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
  });
});

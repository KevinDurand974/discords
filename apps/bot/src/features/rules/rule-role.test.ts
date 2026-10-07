import { describe, expect, it, vi } from "vitest";
import {
  PermissionFlagsBits as P,
  PermissionsBitField,
  type GuildMember,
  type Role,
} from "discord.js";
import { assertSafeRuleRole, RULE_ROLE_PERMISSIONS } from "./rule-role.ts";

function fixture() {
  const everyone = { id: "guild", permissions: new PermissionsBitField() } as Role;
  const role = {
    id: "accepted",
    managed: false,
    editable: true,
    permissions: new PermissionsBitField(RULE_ROLE_PERMISSIONS),
  } as Role;
  const bot = {
    roles: { highest: { comparePositionTo: vi.fn(() => 1) } },
  } as unknown as GuildMember;
  return { everyone, role, bot };
}

describe("Rules acknowledgment role", () => {
  it("has no permissions and serves only as an acceptance marker", () => {
    expect(RULE_ROLE_PERMISSIONS).toBe(0n);
    expect(new PermissionsBitField(RULE_ROLE_PERMISSIONS).toArray()).toEqual([]);
    const f = fixture();
    expect(() => assertSafeRuleRole(f.role, f.everyone, f.bot)).not.toThrow();
  });
  it.each(Object.entries(P))(
    "rejects a role granting %s, even if @everyone has it",
    (_name, permission) => {
      const f = fixture();
      f.everyone.permissions.add(permission);
      f.role.permissions.add(permission);
      expect(() => assertSafeRuleRole(f.role, f.everyone, f.bot)).toThrow("without permissions");
    },
  );
});

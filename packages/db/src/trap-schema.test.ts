import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { botTrapSettings } from "./schema.ts";

describe("bot trap persistence", () => {
  it("binds a unique trap channel to one server", () => {
    expect(getTableName(botTrapSettings)).toBe("bot_trap_settings");
    expect(Object.keys(getTableColumns(botTrapSettings))).toEqual(["guildId", "channelId"]);
    expect(botTrapSettings.guildId.primary).toBe(true);
    expect(botTrapSettings.channelId.notNull).toBe(true);
    expect(botTrapSettings.channelId.isUnique).toBe(true);
  });
});

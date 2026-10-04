import { afterEach, describe, expect, it, vi } from "vitest";
import type { AutocompleteInteraction } from "discord.js";
import { slaCommand } from "./sla.command.ts";

function request(query = "gold") {
  return {
    createdTimestamp: 19_800,
    client: { ws: { ping: 34 } },
    options: {
      getSubcommand: () => "create-coupon",
      getFocused: () => ({ name: "item_1", value: query }),
      getString: () => null,
    },
    respond: vi.fn(async (_choices: unknown) => {}),
  };
}
function clock() {
  vi.spyOn(Date, "now").mockReturnValue(20_000);
  vi.spyOn(performance, "now")
    .mockReturnValueOnce(1000)
    .mockReturnValueOnce(1002)
    .mockReturnValueOnce(1003)
    .mockReturnValueOnce(1123);
  return vi.spyOn(console, "info").mockImplementation(() => {});
}
afterEach(() => vi.restoreAllMocks());

describe("temporary coupon autocomplete timing", () => {
  it("separates lookup, Discord response, handler duration, delivery age and WebSocket ping", async () => {
    const log = clock();
    const interaction = request();
    await slaCommand.autocomplete(interaction as unknown as AutocompleteInteraction);
    expect(interaction.respond).toHaveBeenCalledWith([{ name: "Gold", value: "Gold" }]);
    expect(log).toHaveBeenCalledExactlyOnceWith("[DEBUG-coupon-autocomplete]", {
      interaction_age_ms_at_handler: 200,
      lookup_ms: 1,
      respond_ms: 120,
      handler_ms: 123,
      ws_ping_ms: 34,
      query_length: 4,
      matches: 1,
      status: "success",
    });
    expect(interaction.respond.mock.invocationCallOrder[0]).toBeLessThan(
      log.mock.invocationCallOrder[0]!,
    );
  });
  it("records failed responses without swallowing the original error", async () => {
    const log = clock();
    const interaction = request();
    const error = new Error("Response failed");
    interaction.respond.mockRejectedValueOnce(error);
    await expect(
      slaCommand.autocomplete(interaction as unknown as AutocompleteInteraction),
    ).rejects.toBe(error);
    expect(log).toHaveBeenCalledWith(
      "[DEBUG-coupon-autocomplete]",
      expect.objectContaining({ respond_ms: 120, status: "error" }),
    );
  });
  it("does not log search text, interaction data or user identifiers", async () => {
    const log = clock();
    const interaction = {
      ...request("private-search-text"),
      user: { id: "private-user-id" },
      guildId: "private-guild-id",
    };
    await slaCommand.autocomplete(interaction as unknown as AutocompleteInteraction);
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain("private-search-text");
    expect(output).not.toContain("private-user-id");
    expect(output).not.toContain("private-guild-id");
    expect(log).toHaveBeenCalledWith(
      "[DEBUG-coupon-autocomplete]",
      expect.objectContaining({ query_length: 19, matches: 0 }),
    );
  });
  it("does not instrument unrelated SLA autocomplete requests", async () => {
    const log = clock();
    const interaction = request();
    interaction.options.getSubcommand = () => "redeem";
    await slaCommand.autocomplete(interaction as unknown as AutocompleteInteraction);
    expect(interaction.respond).toHaveBeenCalledWith([]);
    expect(log).not.toHaveBeenCalled();
  });
});

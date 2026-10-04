import { describe, expect, it, vi } from "vitest";
import {
  Collection,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type Client,
  type Interaction,
} from "discord.js";
import { registerInteractionRouter } from "./interaction-router.ts";
import type { CommandDefinition, CommandExecutionContext } from "./command.ts";

function fixture(autocomplete?: CommandDefinition["autocomplete"]) {
  let route: ((interaction: Interaction) => Promise<void>) | undefined;
  const client = {
    on: (_event: string, handler: (interaction: Interaction) => Promise<void>) => {
      route = handler;
    },
  } as unknown as Client;
  const execute = vi.fn();
  const command: CommandDefinition = {
    data: new SlashCommandBuilder().setName("setup").setDescription("Setup"),
    execute,
    ...(autocomplete ? { autocomplete } : {}),
  };
  const context: CommandExecutionContext = { commandLogger: { log: vi.fn(), setChannel: vi.fn() } };
  registerInteractionRouter(client, new Collection([["setup", command]]), [], context);
  return { route: (interaction: AutocompleteInteraction) => route!(interaction), execute, context };
}
function interaction(commandName = "setup") {
  return {
    commandName,
    isAutocomplete: () => true,
    respond: vi.fn(async () => {}),
    responded: false,
  } as unknown as AutocompleteInteraction;
}
describe("autocomplete routing", () => {
  it("routes autocomplete independently without executing or logging a command", async () => {
    const autocomplete = vi.fn(async (request: AutocompleteInteraction) => {
      await request.respond([{ name: "Creator", value: "tag" }]);
    });
    const { route, execute, context } = fixture(autocomplete);
    const request = interaction();
    await route(request);
    expect(autocomplete).toHaveBeenCalledWith(request);
    expect(request.respond).toHaveBeenCalledWith([{ name: "Creator", value: "tag" }]);
    expect(execute).not.toHaveBeenCalled();
    expect(context.commandLogger.log).not.toHaveBeenCalled();
  });
  it("responds with no suggestions for commands without autocomplete", async () => {
    const { route } = fixture();
    const request = interaction();
    await route(request);
    expect(request.respond).toHaveBeenCalledWith([]);
  });
  it("responds with no suggestions for unknown commands", async () => {
    const { route } = fixture();
    const request = interaction("unknown");
    await route(request);
    expect(request.respond).toHaveBeenCalledWith([]);
  });
  it("falls back to an empty response when autocomplete fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { route } = fixture(async () => {
        throw new Error("DB unavailable");
      });
      const request = interaction();
      await route(request);
      expect(request.respond).toHaveBeenCalledWith([]);
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});

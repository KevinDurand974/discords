import { describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  ComponentType,
  type AutocompleteInteraction,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands, helpCommand } from "@/core/command-registry.ts";
import type { CommandDefinition, CommandExecutionContext } from "@/core/command.ts";
import { createHelpCommand, renderCommandHelp, renderHelp } from "./help.command.ts";

function renderedText(definitions: readonly CommandDefinition[], name?: string) {
  return (name === undefined ? renderHelp(definitions) : renderCommandHelp(definitions, name))
    .flatMap((page) =>
      page.components[0]!.toJSON().components.flatMap((component) =>
        component.type === ComponentType.TextDisplay ? [component.content] : [],
      ),
    )
    .join("\n");
}
function interaction(selected: string | null = null) {
  return {
    options: { getString: vi.fn(() => selected) },
    deferReply: vi.fn(),
    editReply: vi.fn(),
    user: { send: vi.fn<(message: unknown) => Promise<void>>(async () => {}) },
  };
}
const context = {} as CommandExecutionContext;
describe("/help", () => {
  it("is registered with one optional autocompleted command and no default permission restrictions", () => {
    expect(commands).toContain(helpCommand);
    expect(helpCommand.data.toJSON().name).toBe("help");
    expect(helpCommand.data.toJSON().options).toMatchObject([
      { name: "command", type: ApplicationCommandOptionType.String, autocomplete: true },
    ]);
    expect(helpCommand.data.toJSON().options?.[0]?.required).not.toBe(true);
    expect(helpCommand.data.toJSON().default_member_permissions).toBeUndefined();
  });
  it("lists every registered command and nested subcommand using the current registry", () => {
    const text = renderedText(commands);
    for (const path of [
      "/help",
      "/ping",
      "/logs",
      "/setup youtube",
      "/setup clean",
      "/youtube add",
      "/youtube status",
      "/youtube sync",
      "/sla redeem",
      "/sla create-coupon",
      "/sla news create",
      "/sla news backfill",
      "/sla news status",
      "/sla news disable",
      "/sla news clean",
    ])
      expect(text).toContain(path);
    expect(text).not.toContain("/setup logs");
    expect(text).not.toContain("/videos");
    expect(text).not.toContain("/setup news");
    expect(text).not.toContain("`/sla create ");
    expect(text).toContain("`/sla redeem`");
    expect(text).not.toContain("/sla redeem [");
    expect(text).toContain("[tag]");
    expect(text).toContain("[backfill-count]");
  });
  it("renders the help documentation in English", () => {
    const text = renderedText(commands);
    expect(text).toContain("# Help — bot commands");
    expect(text).toContain("`<parameter>` required · `[parameter]` optional");
    expect(text).toContain("Some commands require moderation or administrator permissions.");
    expect(text).not.toMatch(/Aide|paramètre|obligatoire|facultatif/);
  });
  it("marks required and optional parameters distinctly", () => {
    const definition: CommandDefinition = {
      data: new SlashCommandBuilder()
        .setName("example")
        .setDescription("Example")
        .addStringOption((option) =>
          option.setName("required").setDescription("Required").setRequired(true),
        )
        .addIntegerOption((option) => option.setName("optional").setDescription("Optional")),
      execute: vi.fn(),
    };
    expect(renderedText([definition])).toContain("/example <required> [optional]");
  });
  it("uses Components V2 containers, text displays and visible separators without mentions", () => {
    for (const page of renderHelp(commands)) {
      expect(page.flags).toBe(MessageFlags.IsComponentsV2);
      expect(page.allowedMentions).toEqual({ parse: [] });
      const container = page.components[0]!.toJSON();
      expect(container.type).toBe(ComponentType.Container);
      expect(container.components).toContainEqual(
        expect.objectContaining({ type: ComponentType.TextDisplay }),
      );
      expect(container.components).toContainEqual(
        expect.objectContaining({ type: ComponentType.Separator, divider: true }),
      );
      expect(page).not.toHaveProperty("content");
      expect(page).not.toHaveProperty("embeds");
    }
  });
  it("paginates a large registry within Discord text/component limits without dropping commands", () => {
    const definitions = Array.from({ length: 50 }, (_, index) => ({
      data: new SlashCommandBuilder()
        .setName(`command-${index}`)
        .setDescription("A long command description ".repeat(3)),
      execute: vi.fn(),
    }));
    const pages = renderHelp(definitions);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      const components = page.components[0]!.toJSON().components;
      expect(components.length + 1).toBeLessThanOrEqual(40);
      expect(
        components.reduce(
          (length, component) =>
            length + (component.type === ComponentType.TextDisplay ? component.content.length : 0),
          0,
        ),
      ).toBeLessThanOrEqual(4000);
    }
    const text = renderedText(definitions);
    for (const definition of definitions) expect(text).toContain(`\`/${definition.data.name}\``);
  });
  it("sends the list by DM after deferring and acknowledges privately in the channel", async () => {
    const request = interaction();
    await helpCommand.execute(request as unknown as ChatInputCommandInteraction, context);
    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(request.user.send).toHaveBeenCalledTimes(renderHelp(commands).length);
    expect(request.user.send).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.IsComponentsV2 }),
    );
    expect(request.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      request.user.send.mock.invocationCallOrder[0]!,
    );
    expect(request.editReply).toHaveBeenCalledWith("The command list has been sent to you by DM.");
    expect(request.editReply).not.toHaveBeenCalledWith(
      expect.objectContaining({ components: expect.anything() }),
    );
  });
  it("reports blocked DMs privately without falling back to a public command list", async () => {
    const request = interaction();
    request.user.send.mockRejectedValueOnce(new Error("Cannot send messages to this user"));
    await helpCommand.execute(request as unknown as ChatInputCommandInteraction, context);
    expect(request.editReply).toHaveBeenCalledWith(
      "Unable to send you the complete command list by DM. Make sure your direct messages are enabled, then try /help again.",
    );
    expect(request.editReply).not.toHaveBeenCalledWith(
      "The command list has been sent to you by DM.",
    );
  });
  it("offers every root command except help in autocomplete", async () => {
    const respond = vi.fn();
    await helpCommand.autocomplete!({
      options: { getFocused: () => "" },
      respond,
    } as unknown as AutocompleteInteraction);
    expect(respond).toHaveBeenCalledWith(
      commands
        .filter(({ data }) => data.name !== "help")
        .map(({ data }) => ({ name: `/${data.name}`, value: data.name })),
    );
    expect(respond.mock.calls[0]![0]).not.toContainEqual(
      expect.objectContaining({ value: "help" }),
    );
  });
  it("filters autocomplete case-insensitively and limits suggestions to 25", async () => {
    const definitions = Array.from({ length: 30 }, (_, index) => ({
      data: new SlashCommandBuilder().setName(`test-${index}`).setDescription("Test"),
      execute: vi.fn(),
    }));
    const command = createHelpCommand(() => definitions);
    const respond = vi.fn();
    await command.autocomplete!({
      options: { getFocused: () => "/TEST" },
      respond,
    } as unknown as AutocompleteInteraction);
    expect(respond.mock.calls[0]![0]).toHaveLength(25);
    await helpCommand.autocomplete!({
      options: { getFocused: () => "does-not-exist" },
      respond,
    } as unknown as AutocompleteInteraction);
    expect(respond).toHaveBeenLastCalledWith([]);
  });
  it("documents every current command with extended feature-specific descriptions", () => {
    commands
      .filter(({ data }) => data.name !== "help")
      .forEach(({ data, helpDescription }) => {
        expect(helpDescription?.length).toBeGreaterThan(0);
        const text = renderedText(commands, data.name);
        expect(text).toContain(`/${data.name} — detailed help`);
        expect(text).toContain(helpDescription![0]);
        expect(data.toJSON()).not.toHaveProperty("helpDescription");
      });
    const clear = renderedText(commands, "clear");
    expect(clear).toContain("count defaults to 10");
    expect(clear).toContain("maximum: 100");
    expect(clear).toContain("14 days old or older");
    expect(clear).toContain("Manage Messages");
    expect(clear).toContain("**channel** (optional)");
    expect(clear).not.toContain("## /coinflip");
    expect(renderedText(commands, "sla")).toContain("/sla news backfill");
  });
  it("reads detailed descriptions from command definitions, including commands registered later", async () => {
    const definitions: CommandDefinition[] = [];
    const command = createHelpCommand(() => definitions);
    definitions.push({
      data: new SlashCommandBuilder().setName("later").setDescription("Short description"),
      helpDescription: ["A detailed description owned by this command.", "Example: `/later`"],
      execute: vi.fn(),
    });
    const request = interaction("later");
    await command.execute(request as unknown as ChatInputCommandInteraction, context);
    const sent = JSON.stringify(request.user.send.mock.calls);
    expect(sent).toContain("A detailed description owned by this command.");
    expect(sent).toContain("Example: `/later`");
    expect(sent).toContain("Short description");
  });
  it("falls back to the slash description for commands without detailed help", () => {
    const definition: CommandDefinition = {
      data: new SlashCommandBuilder().setName("later").setDescription("Fallback description"),
      execute: vi.fn(),
    };
    expect(renderedText([definition], "later")).toContain("Fallback description");
  });
  it("sends selected-command help privately by DM and normalizes the command name", async () => {
    const request = interaction(" /CLEAR ");
    await helpCommand.execute(request as unknown as ChatInputCommandInteraction, context);
    expect(request.options.getString).toHaveBeenCalledWith("command");
    expect(JSON.stringify(request.user.send.mock.calls)).toContain("/clear — detailed help");
    expect(JSON.stringify(request.user.send.mock.calls)).not.toContain("## /coinflip");
    expect(request.editReply).toHaveBeenCalledWith(
      "Detailed help for /clear has been sent to you by DM.",
    );
  });
  it.each(["help", "unknown", ""])(
    "rejects invalid selected command %s without sending a DM",
    async (name) => {
      const request = interaction(name);
      await expect(
        helpCommand.execute(request as unknown as ChatInputCommandInteraction, context),
      ).rejects.toThrow("autocomplete list");
      expect(request.user.send).not.toHaveBeenCalled();
    },
  );
  it("reports blocked DMs for detailed help privately", async () => {
    const request = interaction("pick");
    request.user.send.mockRejectedValueOnce(new Error("Cannot send messages"));
    await helpCommand.execute(request as unknown as ChatInputCommandInteraction, context);
    expect(request.editReply).toHaveBeenCalledWith(
      "Unable to send you detailed command help by DM. Make sure your direct messages are enabled, then try /help again.",
    );
  });
  it("keeps detailed help within Components V2 limits", () => {
    commands
      .filter(({ data }) => data.name !== "help")
      .forEach(({ data }) => {
        renderCommandHelp(commands, data.name).forEach((page) => {
          const components = page.components[0]!.toJSON().components;
          expect(components.length + 1).toBeLessThanOrEqual(40);
          expect(
            components.reduce(
              (length, component) =>
                length +
                (component.type === ComponentType.TextDisplay ? component.content.length : 0),
              0,
            ),
          ).toBeLessThanOrEqual(4000);
          expect(page.allowedMentions).toEqual({ parse: [] });
        });
      });
  });
  it("reads the registry at execution time, including commands registered later", async () => {
    const definitions: CommandDefinition[] = [];
    const command = createHelpCommand(() => definitions);
    definitions.push({
      data: new SlashCommandBuilder().setName("later").setDescription("Registered later"),
      execute: vi.fn(),
    });
    const request = interaction();
    await command.execute(request as unknown as ChatInputCommandInteraction, context);
    const sent = request.user.send.mock.calls[0]?.[0];
    expect(JSON.stringify(sent)).toContain("/later");
  });
});

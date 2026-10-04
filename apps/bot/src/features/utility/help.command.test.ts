import { describe, expect, it, vi } from "vitest";
import {
  ComponentType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands, helpCommand } from "@/core/command-registry.ts";
import type { CommandDefinition, CommandExecutionContext } from "@/core/command.ts";
import { createHelpCommand, renderHelp } from "./help.command.ts";

function renderedText(definitions: readonly CommandDefinition[]) {
  return renderHelp(definitions)
    .flatMap((page) =>
      page.components[0]!.toJSON().components.flatMap((component) =>
        component.type === ComponentType.TextDisplay ? [component.content] : [],
      ),
    )
    .join("\n");
}
function interaction() {
  return {
    deferReply: vi.fn(),
    editReply: vi.fn(),
    user: { send: vi.fn<(message: unknown) => Promise<void>>(async () => {}) },
  };
}
const context = {} as CommandExecutionContext;
describe("/help", () => {
  it("is registered with no parameters or default permission restrictions", () => {
    expect(commands).toContain(helpCommand);
    expect(helpCommand.data.toJSON().name).toBe("help");
    expect(helpCommand.data.toJSON().options ?? []).toEqual([]);
    expect(helpCommand.data.toJSON().default_member_permissions).toBeUndefined();
  });
  it("lists every registered command and nested subcommand using the current registry", () => {
    const text = renderedText(commands);
    for (const path of [
      "/help",
      "/ping",
      "/setup logs",
      "/setup youtube",
      "/setup clean",
      "/youtube add",
      "/youtube status",
      "/youtube sync",
      "/sla redeem",
      "/sla create <code>",
      "/sla news create",
      "/sla news backfill",
      "/sla news status",
      "/sla news disable",
      "/sla news clean",
    ])
      expect(text).toContain(path);
    expect(text).not.toContain("/videos");
    expect(text).not.toContain("/setup news");
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

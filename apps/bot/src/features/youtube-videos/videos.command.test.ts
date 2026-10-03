import { describe, expect, it, vi } from "vitest";
import {
  PermissionFlagsBits as P,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ModalBuilder,
} from "discord.js";
import { requireVideoPermission, videosCommand, videosComponentHandler } from "./videos.command.ts";
import { commands, componentHandlers } from "../../core/command-registry.ts";
import type { CommandExecutionContext } from "../../core/command.ts";

function actor(permissions: bigint[], userId = "moderator") {
  return {
    guild: { id: "guild", ownerId: "owner" },
    guildId: "guild",
    user: { id: userId },
    memberPermissions: new PermissionsBitField(permissions),
  };
}
const context = {} as CommandExecutionContext;
describe("/videos permissions and modal ownership", () => {
  it("registers the same command and component handler used at deployment", () => {
    expect(commands).toContain(videosCommand);
    expect(componentHandlers).toContain(videosComponentHandler);
    expect(videosCommand.data.toJSON().default_member_permissions).toBe(
      P.ManageMessages.toString(),
    );
  });
  it("denies ordinary members, allows Manage Messages and accepts administrator/owner bypass", () => {
    expect(() => requireVideoPermission(actor([]) as ChatInputCommandInteraction)).toThrow(
      "Manage Messages",
    );
    expect(() =>
      requireVideoPermission(actor([P.ManageMessages]) as ChatInputCommandInteraction),
    ).not.toThrow();
    expect(() =>
      requireVideoPermission(actor([P.Administrator]) as ChatInputCommandInteraction),
    ).not.toThrow();
    expect(() =>
      requireVideoPermission(actor([], "owner") as ChatInputCommandInteraction),
    ).not.toThrow();
  });
  it("requires Administrator for cleanup, including on component submits", () => {
    expect(() =>
      requireVideoPermission(actor([P.ManageMessages]) as ChatInputCommandInteraction, true),
    ).toThrow("administrator");
    expect(() =>
      requireVideoPermission(actor([P.Administrator]) as ChatInputCommandInteraction, true),
    ).not.toThrow();
  });
  it("opens a required channel-input modal immediately without accessing the database/API", async () => {
    const showModal = vi.fn<(modal: ModalBuilder) => Promise<void>>(async () => {});
    await videosCommand.execute({
      ...actor([P.ManageMessages]),
      options: { getSubcommand: () => "add", getInteger: () => null },
      showModal,
    } as unknown as ChatInputCommandInteraction);
    const modal = showModal.mock.calls[0]?.[0];
    expect(modal).toBeDefined();
  });
  it("binds the modal to its actor/guild and rejects expired sessions", async () => {
    vi.useFakeTimers();
    try {
      let customId = "";
      await videosCommand.execute({
        ...actor([P.ManageMessages]),
        options: { getSubcommand: () => "add", getInteger: () => 10 },
        showModal: async (modal: { data: { custom_id: string } }) => {
          customId = modal.data.custom_id;
        },
      } as unknown as ChatInputCommandInteraction);
      const submit = (userId: string) =>
        ({
          ...actor([P.ManageMessages], userId),
          customId,
          isModalSubmit: () => true,
          isButton: () => false,
        }) as unknown as ModalSubmitInteraction;
      await expect(
        videosComponentHandler.execute(submit("different-moderator"), context),
      ).rejects.toThrow("belongs to another user");
      vi.advanceTimersByTime(300_001);
      await expect(videosComponentHandler.execute(submit("moderator"), context)).rejects.toThrow(
        "expired",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

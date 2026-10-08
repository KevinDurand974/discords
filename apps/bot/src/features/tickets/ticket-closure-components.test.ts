import { beforeEach, describe, expect, it, vi } from "vitest";
import { ButtonStyle, ComponentType, MessageFlags, type ButtonInteraction } from "discord.js";
import { componentHandlers } from "@/core/command-registry.ts";
import {
  ticketClosureComponentHandler as handler,
  ticketClosureMessage,
} from "./ticket-closure-components.ts";
import { changeTicketClosure } from "./ticket-runtime.ts";
vi.mock("./ticket-runtime.ts", () => ({
  changeTicketClosure: vi.fn(),
  scheduleTicketClosure: vi.fn(),
}));
const closureId = "12345678-1234-4234-8234-123456789012";
const guild = { id: "guild" };
function fixture(action: "close" | "reopen" = "reopen") {
  const interaction = {
    guild,
    channelId: "channel",
    user: { id: "user" },
    customId: `ticket:closure:${action}:${closureId}`,
    isButton: () => true,
    inGuild: () => true,
    deferUpdate: vi.fn(),
    editReply: vi.fn(),
    deleteReply: vi.fn(),
  };
  return {
    interaction,
    execute: () => handler.execute(interaction as unknown as ButtonInteraction),
  };
}
beforeEach(() => {
  vi.mocked(changeTicketClosure).mockReset().mockResolvedValue(undefined);
});

describe("public ticket closure notice", () => {
  it("uses Components V2 and an ActionRow with two buttons bound to the closure generation", () => {
    const message = ticketClosureMessage({
      closureId,
      guildId: "guild",
      channelId: "channel",
      ownerId: "owner",
      requestedBy: "actor",
      createdAt: new Date("2030-01-01T00:00:00Z"),
      deleteAt: new Date("2030-01-01T00:05:00Z"),
    });
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.flags & MessageFlags.Ephemeral).toBe(0);
    expect(message.allowedMentions).toEqual({ parse: [] });
    const card = message.components[0]!.toJSON();
    expect(card.type).toBe(ComponentType.Container);
    expect(JSON.stringify(card.components[0])).toContain("<t:1893456300:R>");
    expect(JSON.stringify(card.components[0])).not.toContain("The closure delay");
    expect(card.components[1]).toMatchObject({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          label: "Close now",
          style: ButtonStyle.Danger,
          custom_id: `ticket:closure:close:${closureId}`,
        },
        {
          type: ComponentType.Button,
          label: "Reopen",
          style: ButtonStyle.Success,
          custom_id: `ticket:closure:reopen:${closureId}`,
        },
      ],
    });
  });
  it("registers a narrow handler in the central router", () => {
    expect(componentHandlers).toContain(handler);
    expect(handler.matches(`ticket:closure:close:${closureId}`)).toBe(true);
    expect(handler.matches("ticket:modal:123")).toBe(false);
  });
  it("cancels persisted deletion before deleting the notice", async () => {
    const f = fixture();
    await f.execute();
    expect(f.interaction.deferUpdate).toHaveBeenCalledExactlyOnceWith();
    expect(changeTicketClosure).toHaveBeenCalledExactlyOnceWith(
      guild,
      "channel",
      "user",
      closureId,
      "reopen",
    );
    expect(f.interaction.deleteReply).toHaveBeenCalledExactlyOnceWith();
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(changeTicketClosure).mock.invocationCallOrder[0]!,
    );
  });
  it("acknowledges immediate deletion without replying into a deleted channel", async () => {
    const f = fixture("close");
    await f.execute();
    expect(f.interaction.deferUpdate).toHaveBeenCalledExactlyOnceWith();
    expect(changeTicketClosure).toHaveBeenCalledExactlyOnceWith(
      guild,
      "channel",
      "user",
      closureId,
      "close",
    );
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });
  it("keeps the notice unchanged on authorization, stale generation, or persistence failure", async () => {
    const f = fixture();
    vi.mocked(changeTicketClosure).mockRejectedValueOnce(new Error("Closure action refused"));
    await expect(f.execute()).rejects.toThrow("Closure action refused");
    expect(f.interaction.editReply).not.toHaveBeenCalled();
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
  });
  it("rejects malformed custom ids without changing ticket state", async () => {
    const f = fixture();
    f.interaction.customId = "ticket:closure:reopen:invalid";
    await expect(f.execute()).rejects.toThrow(
      "This button is unavailable. Run /close-ticket again",
    );
    expect(changeTicketClosure).not.toHaveBeenCalled();
  });
  it("rejects DMs", async () => {
    const f = fixture();
    f.interaction.inGuild = () => false;
    await expect(f.execute()).rejects.toThrow("server");
    expect(changeTicketClosure).not.toHaveBeenCalled();
  });
});

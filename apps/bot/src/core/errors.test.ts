import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { replyWithError, UserFacingError } from "./errors.ts";

afterEach(() => vi.restoreAllMocks());

function fixture(replied = false, deferred = false) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const interaction = {
    replied,
    deferred,
    reply: vi.fn(async (_options: unknown) => {}),
    followUp: vi.fn(async (_options: unknown) => {}),
  };
  return { interaction, request: interaction as unknown as Parameters<typeof replyWithError>[0] };
}

describe("user-facing errors", () => {
  it("preserves actionable permission requirements", async () => {
    const f = fixture();
    await replyWithError(f.request, new UserFacingError("You need Manage Roles."));
    expect(f.interaction.reply).toHaveBeenCalledWith({
      content: "You need Manage Roles.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it.each([
    new Error("Failed query: postgres://secret"),
    new TypeError("fetch failed"),
    "internal state",
  ])("does not expose unexpected errors: %s", async (error) => {
    const f = fixture();
    await replyWithError(f.request, error);
    expect(f.interaction.reply).toHaveBeenCalledWith({
      content:
        "Couldn't complete this action. Please try again. If it keeps failing, contact a server administrator.",
      flags: MessageFlags.Ephemeral,
    });
    expect(console.error).toHaveBeenCalledWith("Interaction failed", error);
  });

  it.each([
    [true, false],
    [false, true],
  ])("keeps errors visible after acknowledgment", async (replied, deferred) => {
    const f = fixture(replied, deferred);
    await replyWithError(f.request, new UserFacingError("Couldn't finish. Try again."));
    expect(f.interaction.reply).not.toHaveBeenCalled();
    expect(f.interaction.followUp).toHaveBeenCalledWith({
      content: "Couldn't finish. Try again.",
      flags: MessageFlags.Ephemeral,
    });
  });
});

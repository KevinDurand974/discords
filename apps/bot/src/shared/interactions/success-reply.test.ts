import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editSuccessReply } from "./success-reply.ts";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function fixture() {
  const interaction = {
    editReply: vi.fn(async (_options: unknown) => {}),
    deleteReply: vi.fn(async () => {}),
  };
  return {
    interaction,
    reply: () =>
      editSuccessReply(interaction as unknown as Parameters<typeof editSuccessReply>[0], {
        content: "Done.",
      }),
  };
}

describe("successful deferred reply cleanup", () => {
  it("deletes only 10 seconds after the final reply is displayed, not during deferral", async () => {
    const f = fixture();
    let display!: () => void;
    f.interaction.editReply.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          display = resolve;
        }),
    );
    const reply = f.reply();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.getTimerCount()).toBe(0);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    display();
    await reply;
    await vi.advanceTimersByTimeAsync(9_999);
    expect(f.interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("supports plain-text confirmations", async () => {
    const f = fixture();
    await editSuccessReply(
      f.interaction as unknown as Parameters<typeof editSuccessReply>[0],
      "Done.",
    );
    expect(f.interaction.editReply).toHaveBeenCalledWith("Done.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
  it("does not keep the process alive", async () => {
    const f = fixture();
    const timer = vi.spyOn(globalThis, "setTimeout");
    await f.reply();
    expect(timer.mock.results[0]?.value.hasRef()).toBe(false);
  });
  it("does not schedule deletion if the success reply fails to display", async () => {
    const f = fixture();
    f.interaction.editReply.mockRejectedValue(new Error("Reply failed"));
    await expect(f.reply()).rejects.toThrow("Reply failed");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("handles a dismissed or already deleted reply without unhandled rejections", async () => {
    const f = fixture();
    f.interaction.deleteReply.mockRejectedValue(new Error("Unknown Message"));
    await f.reply();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.interaction.deleteReply).toHaveBeenCalledOnce();
  });
});

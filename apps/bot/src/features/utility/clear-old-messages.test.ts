import { describe, expect, it, vi } from "vitest";
import { Collection, DiscordAPIError, RESTJSONErrorCodes, type TextChannel } from "discord.js";
import { clearMessages, MAX_CLEAR_AGE_MS } from "./clear-messages.ts";

function fixture(ages: number[]) {
  const messages = ages.map((age, index) => ({
    id: String(index),
    author: { id: "target" },
    createdTimestamp: Date.now() - age,
    delete: vi.fn(async () => {}),
  }));
  const channel = {
    messages: {
      fetch: vi.fn(async () => new Collection(messages.map((message) => [message.id, message]))),
    },
    bulkDelete: vi.fn(
      async (selected: typeof messages, _filterOld: boolean) =>
        new Collection(selected.map((message) => [message.id, message])),
    ),
  };
  return {
    messages,
    channel,
    run: () => clearMessages(channel as unknown as TextChannel, messages.length),
  };
}

function unknownMessage() {
  return new DiscordAPIError(
    { code: RESTJSONErrorCodes.UnknownMessage, message: "Unknown Message" },
    RESTJSONErrorCodes.UnknownMessage,
    404,
    "DELETE",
    "https://discord.com/api/v10/channels/channel/messages/message",
    {},
  );
}

describe("old message deletion", () => {
  it("waits for each deletion to finish before starting the next", async () => {
    const f = fixture([MAX_CLEAR_AGE_MS + 1000, MAX_CLEAR_AGE_MS + 2000]);
    const pending = Promise.withResolvers<void>();
    f.messages[0]!.delete.mockImplementationOnce(() => pending.promise);
    const operation = f.run();
    try {
      await vi.waitFor(() => expect(f.messages[0]!.delete).toHaveBeenCalledOnce());
      expect(f.messages[1]!.delete).not.toHaveBeenCalled();
    } finally {
      pending.resolve();
    }
    expect(await operation).toBe(2);
    expect(f.messages[1]!.delete).toHaveBeenCalledOnce();
    expect(f.channel.bulkDelete).not.toHaveBeenCalled();
  });

  it("bulk-deletes recent messages and individually deletes the exact 14-day boundary and older", async () => {
    const f = fixture([0, 1000, MAX_CLEAR_AGE_MS, MAX_CLEAR_AGE_MS + 1000]);
    expect(await f.run()).toBe(4);
    expect(f.channel.bulkDelete).toHaveBeenCalledExactlyOnceWith(f.messages.slice(0, 2), true);
    expect(f.messages[0]!.delete).not.toHaveBeenCalled();
    expect(f.messages[1]!.delete).not.toHaveBeenCalled();
    expect(f.messages[2]!.delete).toHaveBeenCalledOnce();
    expect(f.messages[3]!.delete).toHaveBeenCalledOnce();
  });

  it("deletes messages skipped by bulkDelete if they age past the boundary before the request", async () => {
    const f = fixture([0, 1000]);
    f.channel.bulkDelete.mockResolvedValueOnce(new Collection([["0", f.messages[0]!]]));
    expect(await f.run()).toBe(2);
    expect(f.messages[0]!.delete).not.toHaveBeenCalled();
    expect(f.messages[1]!.delete).toHaveBeenCalledOnce();
  });

  it("ignores confirmed Unknown Message errors and counts only successful deletions", async () => {
    const f = fixture([MAX_CLEAR_AGE_MS, MAX_CLEAR_AGE_MS]);
    f.messages[0]!.delete.mockRejectedValueOnce(unknownMessage());
    expect(await f.run()).toBe(1);
    expect(f.messages[1]!.delete).toHaveBeenCalledOnce();
  });

  it("returns zero when all selected messages were already deleted", async () => {
    const f = fixture([MAX_CLEAR_AGE_MS]);
    f.messages[0]!.delete.mockRejectedValueOnce(unknownMessage());
    expect(await f.run()).toBe(0);
  });

  it("stops on permission failures without starting further deletions", async () => {
    const f = fixture([MAX_CLEAR_AGE_MS, MAX_CLEAR_AGE_MS]);
    f.messages[0]!.delete.mockRejectedValueOnce(new Error("Missing Permissions"));
    await expect(f.run()).rejects.toThrow("Missing Permissions");
    expect(f.messages[1]!.delete).not.toHaveBeenCalled();
  });

  it("reports partial progress on failure and stops the series", async () => {
    const f = fixture([0, MAX_CLEAR_AGE_MS, MAX_CLEAR_AGE_MS]);
    f.messages[1]!.delete.mockRejectedValueOnce(new Error("offline"));
    await expect(f.run()).rejects.toThrow(
      "Deleted 1 message, but couldn't delete the rest. Check bot permissions, then try /clear again.",
    );
    expect(f.messages[2]!.delete).not.toHaveBeenCalled();
  });
});

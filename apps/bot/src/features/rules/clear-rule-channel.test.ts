import { describe, expect, it, vi } from "vitest";
import { Collection, type TextChannel } from "discord.js";
import { clearRuleChannel } from "./clear-rule-channel.ts";

const message = (id: string) => ({ id, delete: vi.fn(async () => {}) });

describe("clear rules channel", () => {
  it("paginates through the entire history and deletes old and pinned messages too", async () => {
    const first = Array.from({ length: 100 }, (_, index) => message(String(300 - index)));
    const old = { ...message("100"), pinned: true, createdTimestamp: 0 };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Collection(first.map((entry) => [entry.id, entry])))
      .mockResolvedValueOnce(new Collection([[old.id, old]]))
      .mockResolvedValueOnce(new Collection());
    await clearRuleChannel({ messages: { fetch } } as unknown as TextChannel);
    expect(fetch.mock.calls).toEqual([
      [{ limit: 100 }],
      [{ limit: 100, before: "201" }],
      [{ limit: 100, before: "100" }],
    ]);
    first.forEach((entry) => expect(entry.delete).toHaveBeenCalledOnce());
    expect(old.delete).toHaveBeenCalledOnce();
  });

  it("stops on an undeletable message rather than publishing over incomplete history", async () => {
    const entry = message("100");
    entry.delete.mockRejectedValue(new Error("Missing Permissions"));
    const fetch = vi.fn().mockResolvedValue(new Collection([[entry.id, entry]]));
    await expect(
      clearRuleChannel({ messages: { fetch } } as unknown as TextChannel),
    ).rejects.toThrow("Missing Permissions");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("accepts an empty channel", async () => {
    const fetch = vi.fn().mockResolvedValue(new Collection());
    await clearRuleChannel({ messages: { fetch } } as unknown as TextChannel);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

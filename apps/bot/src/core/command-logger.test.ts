import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import { createCommandLogger } from "./command-logger.ts";
import type { CommandLogEntry } from "./command.ts";

const entry: CommandLogEntry = {
  guildId: "123",
  command: "/ping",
  userId: "456",
  userTag: "tester",
  status: "success",
};

function fixture() {
  const send = vi.fn().mockResolvedValue(undefined);
  const fetch = vi.fn().mockResolvedValue({ isSendable: () => true, send });
  const client = { channels: { fetch } } as unknown as Client;
  const store = {
    getChannel: vi.fn().mockResolvedValue("789"),
    setChannel: vi.fn().mockResolvedValue(undefined),
  };
  return { logger: createCommandLogger(client, store), store, fetch, send };
}

afterEach(() => vi.restoreAllMocks());

describe("database-backed command logger", () => {
  it("persists the configured channel and propagates write failures", async () => {
    const { logger, store } = fixture();
    await logger.setChannel("123", "789");
    expect(store.setChannel).toHaveBeenCalledWith("123", "789");
    store.setChannel.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(logger.setChannel("123", "999")).rejects.toThrow("database unavailable");
    await expect(logger.setChannel("123", "789")).resolves.toBeUndefined();
  });

  it("reads fresh guild settings on every log and sends the existing embed", async () => {
    const { logger, store, fetch, send } = fixture();
    await logger.log(entry);
    store.getChannel.mockResolvedValueOnce("999");
    await logger.log({ ...entry, status: "error" });
    expect(store.getChannel).toHaveBeenNthCalledWith(1, "123");
    expect(fetch.mock.calls).toEqual([["789"], ["999"]]);
    const embed = send.mock.calls[0]![0].embeds[0].toJSON();
    expect(embed.fields).toEqual([
      { name: "Command", value: "/ping" },
      { name: "User", value: "tester (456)" },
      { name: "Status", value: "success" },
    ]);
    expect(embed.color).toBe(0x57f287);
    expect(send.mock.calls[1]![0].embeds[0].toJSON().color).toBe(0xed4245);
  });

  it("silently skips unconfigured guilds and unsendable channels", async () => {
    const { logger, store, fetch, send } = fixture();
    store.getChannel.mockResolvedValueOnce(null);
    await logger.log(entry);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValueOnce({ isSendable: () => false, send });
    await logger.log(entry);
    expect(send).not.toHaveBeenCalled();
  });

  it("isolates database and Discord failures from command execution", async () => {
    const { logger, store, send } = fixture();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    store.getChannel.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(logger.log(entry)).resolves.toBeUndefined();
    send.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(logger.log(entry)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(2);
  });
});

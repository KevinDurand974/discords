import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordAPIError, type Client } from "discord.js";
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
    clearChannel: vi.fn().mockResolvedValue(undefined),
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

  it("disables a deleted logging destination instead of retrying Unknown Channel on every command", async () => {
    const { logger, store, fetch, send } = fixture();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.mockRejectedValueOnce(
      new DiscordAPIError(
        { code: 10003, message: "Unknown Channel" },
        10003,
        404,
        "GET",
        "/channels/789",
        {},
      ),
    );
    await expect(logger.log({ ...entry, command: "/visibility" })).resolves.toBeUndefined();
    expect(store.clearChannel).toHaveBeenCalledExactlyOnceWith("123", "789");
    expect(send).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("/setup logs"));
    store.getChannel.mockResolvedValueOnce(null);
    await logger.log(entry);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("also recovers if the channel disappears between fetch and send", async () => {
    const { logger, store, send } = fixture();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    send.mockRejectedValueOnce(
      new DiscordAPIError(
        { code: 10003, message: "Unknown Channel" },
        10003,
        404,
        "POST",
        "/channels/789/messages",
        {},
      ),
    );
    await expect(logger.log(entry)).resolves.toBeUndefined();
    expect(store.clearChannel).toHaveBeenCalledExactlyOnceWith("123", "789");
  });

  it.each([50001, 50013])(
    "keeps settings for Discord error %i instead of treating it as a deleted channel",
    async (code) => {
      const { logger, store, fetch } = fixture();
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new DiscordAPIError(
        { code, message: "Missing access or permissions" },
        code,
        403,
        "GET",
        "/channels/789",
        {},
      );
      fetch.mockRejectedValueOnce(error);
      await expect(logger.log(entry)).resolves.toBeUndefined();
      expect(store.clearChannel).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledWith("[Command logger] Failed to send command log.", error);
    },
  );

  it("reports cleanup failures without failing the command", async () => {
    const { logger, store, fetch } = fixture();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("database unavailable");
    fetch.mockRejectedValueOnce(
      new DiscordAPIError(
        { code: 10003, message: "Unknown Channel" },
        10003,
        404,
        "GET",
        "/channels/789",
        {},
      ),
    );
    store.clearChannel.mockRejectedValueOnce(error);
    await expect(logger.log(entry)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      "[Command logger] Failed to clear deleted log channel.",
      error,
    );
  });

  it("isolates database and Discord failures from command execution", async () => {
    const { logger, store, send } = fixture();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    store.getChannel.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(logger.log(entry)).resolves.toBeUndefined();
    send.mockRejectedValueOnce(new Error("Discord unavailable"));
    await expect(logger.log(entry)).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledTimes(2);
    expect(store.clearChannel).not.toHaveBeenCalled();
  });
});

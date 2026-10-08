import { describe, expect, it, vi } from "vitest";
import { Routes, type REST } from "discord.js";
import { commandDefinitionsEqual, syncCommands } from "./command-sync.ts";

const ping = { name: "ping", description: "Replies with pong!", type: 1 as const };

function mockRest(remote: unknown[] = [ping], legacy: unknown[] = []) {
  const get = vi.fn().mockImplementation(async (route: string) => {
    if (route === Routes.oauth2CurrentApplication())
      return { integration_types_config: { "0": {} } };
    if (route === Routes.applicationCommands("app")) return remote;
    return legacy;
  });
  const put = vi.fn().mockResolvedValue([]);
  return { get, put, rest: { get, put } as unknown as Pick<REST, "get" | "put"> };
}

describe("command definition comparison", () => {
  it("ignores generated metadata and normalizes Discord defaults", () => {
    expect(
      commandDefinitionsEqual(
        [ping],
        [
          {
            ...ping,
            id: "123",
            application_id: "app",
            version: "9",
            options: [],
            nsfw: false,
            default_member_permissions: null,
            contexts: [2, 0, 1],
            integration_types: [0],
            name_localizations: null,
          },
        ],
      ),
    ).toBe(true);
  });

  it("ignores command and object-key order", () => {
    const other = { ...ping, name: "help", name_localizations: { fr: "aide", de: "hilfe" } };
    expect(
      commandDefinitionsEqual(
        [ping, other],
        [{ ...other, name_localizations: { de: "hilfe", fr: "aide" } }, ping],
      ),
    ).toBe(true);
  });

  it("uses application installation defaults", () => {
    expect(commandDefinitionsEqual([ping], [{ ...ping, integration_types: [1, 0] }], [0, 1])).toBe(
      true,
    );
  });

  it.each([
    { name: "renamed" },
    { description: "New description" },
    { default_member_permissions: "8" },
    { contexts: [0] },
    { integration_types: [1] },
    { nsfw: true },
    { name_localizations: { fr: "salut" } },
    { options: [{ type: 3, name: "text", description: "Text" }] },
  ])("detects registration changes: %j", (change) => {
    expect(commandDefinitionsEqual([ping], [{ ...ping, ...change }])).toBe(false);
  });

  it("detects added and removed commands", () => {
    expect(commandDefinitionsEqual([ping], [])).toBe(false);
    expect(commandDefinitionsEqual([], [ping])).toBe(false);
  });

  it("normalizes nested options and detects choices and option order", () => {
    const options = [
      { type: 3, name: "text", description: "Text", choices: [{ name: "One", value: "1" }] },
      { type: 5, name: "flag", description: "Flag" },
    ];
    const local = { ...ping, options };
    expect(
      commandDefinitionsEqual(
        [local],
        [
          {
            ...ping,
            options: options.map((o) => ({ ...o, required: false, autocomplete: false })),
          },
        ],
      ),
    ).toBe(true);
    expect(commandDefinitionsEqual([local], [{ ...ping, options: [...options].reverse() }])).toBe(
      false,
    );
    expect(
      commandDefinitionsEqual(
        [local],
        [
          {
            ...ping,
            options: [{ ...options[0], choices: [{ name: "Two", value: "2" }] }, options[1]],
          },
        ],
      ),
    ).toBe(false);
  });
});

describe("conditional synchronization", () => {
  it("performs no writes for unchanged definitions and empty legacy commands", async () => {
    const { rest, put, get } = mockRest();
    expect(await syncCommands(rest, "app", [ping], "guild")).toBe(false);
    expect(put).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(Routes.applicationCommands("app"), {
      query: new URLSearchParams({ with_localizations: "true" }),
    });
  });

  it("bulk overwrites changed definitions", async () => {
    const { rest, put } = mockRest([]);
    expect(await syncCommands(rest, "app", [ping])).toBe(true);
    expect(put).toHaveBeenCalledExactlyOnceWith(Routes.applicationCommands("app"), {
      body: [ping],
    });
  });

  it("clears legacy guild commands even when globals are unchanged", async () => {
    const { rest, put } = mockRest([ping], [ping]);
    await syncCommands(rest, "app", [ping], "guild");
    expect(put).toHaveBeenCalledExactlyOnceWith(Routes.applicationGuildCommands("app", "guild"), {
      body: [],
    });
  });

  it("does not clear legacy commands when global synchronization fails", async () => {
    const { rest, put } = mockRest([], [ping]);
    put.mockRejectedValue(new Error("Discord unavailable"));
    await expect(syncCommands(rest, "app", [ping], "guild")).rejects.toThrow("Discord unavailable");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("propagates read errors without writing", async () => {
    const { rest, get, put } = mockRest();
    get.mockRejectedValue(new Error("Unauthorized"));
    await expect(syncCommands(rest, "app", [ping])).rejects.toThrow("Unauthorized");
    expect(put).not.toHaveBeenCalled();
  });
});

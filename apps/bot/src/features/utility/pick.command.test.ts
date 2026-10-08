import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import type { ComponentInteraction, CommandExecutionContext } from "../../core/command.ts";

const { randomInt } = vi.hoisted(() => ({ randomInt: vi.fn(() => 0) }));
vi.mock("node:crypto", async () => ({
  ...(await vi.importActual<typeof import("node:crypto")>("node:crypto")),
  randomInt,
}));
import { commands, componentHandlers } from "../../core/command-registry.ts";
import { pickCommand } from "./pick.command.ts";
import {
  createPickComponentHandler,
  createPickModal,
  pickComponentHandler,
  renderPickChoices,
} from "./pick-components.ts";
import { createPickSessionStore, parsePickChoices, PICK_SESSION_TTL } from "./pick-choice.ts";

const context = {} as CommandExecutionContext;
const modal = (reply = vi.fn(), choices = "Pizza\nSalad", userId = "user") =>
  ({
    customId: "pick:form:user",
    user: { id: userId },
    isModalSubmit: () => true,
    fields: { getTextInputValue: vi.fn(() => choices) },
    reply,
  }) as unknown as ComponentInteraction;
const button = (token: string, update = vi.fn(), userId = "user") =>
  ({
    customId: `pick:draw:${token}`,
    user: { id: userId },
    isModalSubmit: () => false,
    isButton: () => true,
    update,
  }) as unknown as ComponentInteraction;

beforeEach(() => randomInt.mockReset());
afterEach(() => vi.useRealTimers());

describe("pick choices", () => {
  it("trims choices and ignores empty lines across newline formats", () => {
    expect(parsePickChoices(" A\r\n \nB\rC ")).toEqual(["A", "B", "C"]);
    expect(parsePickChoices("A\nA")).toEqual(["A", "A"]);
  });
  it.each(["", "A", "A\n" + "x".repeat(101), Array(51).fill("A").join("\n"), "x".repeat(1501)])(
    "rejects invalid choices",
    (input) => {
      expect(() => parsePickChoices(input)).toThrow();
    },
  );
  it("uses secure randomness and keeps the same result on repeated clicks", () => {
    randomInt.mockReturnValueOnce(1);
    const store = createPickSessionStore();
    const { token } = store.create("user", ["A", "B", "C"]);
    expect(randomInt).not.toHaveBeenCalled();
    expect(store.draw(token, "user").result).toBe(1);
    expect(store.draw(token, "user").result).toBe(1);
    expect(randomInt).toHaveBeenCalledExactlyOnceWith(0, 3);
  });
  it("blocks other users and expired draws without drawing", () => {
    vi.useFakeTimers();
    const store = createPickSessionStore();
    const { token } = store.create("user", ["A", "B"]);
    expect(() => store.draw(token, "other")).toThrow("Only the person");
    vi.advanceTimersByTime(PICK_SESSION_TTL);
    expect(() => store.draw(token, "user")).toThrow("expired");
    expect(randomInt).not.toHaveBeenCalled();
  });
  it("bounds active sessions and frees expired slots", () => {
    vi.useFakeTimers();
    const store = createPickSessionStore();
    Array.from({ length: 1000 }).forEach(() => store.create("user", ["A", "B"]));
    expect(() => store.create("user", ["A", "B"])).toThrow("Too many");
    vi.advanceTimersByTime(PICK_SESSION_TTL);
    expect(() => store.create("user", ["A", "B"])).not.toThrow();
  });
});

describe("/pick interactions", () => {
  it("registers the command and handler and opens a paragraph input modal", async () => {
    expect(commands).toContain(pickCommand);
    expect(componentHandlers).toContain(pickComponentHandler);
    expect(pickCommand.data.toJSON().name).toBe("pick");
    expect(commands.some((command) => command.data.name === "random")).toBe(false);
    expect(pickCommand.data.toJSON().options).toHaveLength(0);
    const showModal = vi.fn();
    await pickCommand.execute({
      user: { id: "user" },
      showModal,
    } as unknown as ChatInputCommandInteraction);
    expect(showModal).toHaveBeenCalledOnce();
    const data = createPickModal("user").toJSON();
    expect(data.custom_id).toBe("pick:form:user");
    expect(pickComponentHandler.matches("pick:form:user")).toBe(true);
    expect(pickComponentHandler.matches("pick:draw:token")).toBe(true);
    expect(pickComponentHandler.matches("random:draw:token")).toBe(false);
    expect(JSON.stringify(data)).toContain('"style":2');
    expect(randomInt).not.toHaveBeenCalled();
  });
  it("shows choices in Components V2 then updates with one result and disables the button", async () => {
    randomInt.mockReturnValueOnce(1);
    const handler = createPickComponentHandler();
    const reply = vi.fn();
    await handler.execute(modal(reply), context);
    const payload = JSON.parse(JSON.stringify(reply.mock.calls[0]![0]));
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.components[0].components[0].content).toBe("# Pick an option\nPizza\nSalad");
    expect(payload.components[0].components[2].content).toContain("Only <@user> can draw.");
    expect(randomInt).not.toHaveBeenCalled();
    const token = payload.components[0].components
      .at(-1)
      .components[0].custom_id.replace("pick:draw:", "");
    const update = vi.fn();
    await Promise.all([
      handler.execute(button(token, update), context),
      handler.execute(button(token, update), context),
    ]);
    const result = JSON.stringify(update.mock.calls[0]![0]);
    expect(result).toContain("## Result\\nSalad");
    expect(result).toContain('"disabled":true');
    expect(update.mock.calls[0]![0]).toEqual(update.mock.calls[1]![0]);
    expect(randomInt).toHaveBeenCalledExactlyOnceWith(0, 2);
  });
  it("rejects another user's form and invalid input without posting", async () => {
    const handler = createPickComponentHandler();
    const reply = vi.fn();
    await expect(handler.execute(modal(reply, "A\nB", "other"), context)).rejects.toThrow(
      "This form is unavailable. Run /pick again",
    );
    await expect(handler.execute(modal(reply, "A"), context)).rejects.toThrow("2–50");
    expect(reply).not.toHaveBeenCalled();
  });
  it("removes a session when posting fails", async () => {
    const store = createPickSessionStore();
    const remove = vi.spyOn(store, "remove");
    const handler = createPickComponentHandler(store);
    await expect(
      handler.execute(modal(vi.fn().mockRejectedValue(new Error("Cannot send"))), context),
    ).rejects.toThrow("Cannot send");
    expect(remove).toHaveBeenCalledOnce();
    expect(() => store.draw(remove.mock.calls[0]![0], "user")).toThrow("expired");
  });
  it("escapes choice formatting and stays under the V2 text limit", () => {
    const choices = parsePickChoices(Array(15).fill("*".repeat(99)).join("\n"));
    const rendered = renderPickChoices("token", {
      userId: "user",
      choices,
      expiresAt: 0,
      result: 0,
    });
    const payload = rendered.components[0]!.toJSON();
    const text = payload.components
      .filter((component) => component.type === 10)
      .map((component) => component.content)
      .join("");
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).toContain("\\*");
    expect(rendered.allowedMentions.parse).toEqual([]);
  });
});

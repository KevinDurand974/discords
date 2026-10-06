import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatInputCommandInteraction, Emoji } from "discord.js";

const { randomInt } = vi.hoisted(() => ({ randomInt: vi.fn(() => 0) }));
vi.mock("node:crypto", async () => ({
  ...(await vi.importActual<typeof import("node:crypto")>("node:crypto")),
  randomInt,
}));

import { commands } from "../../core/command-registry.ts";
import { coinflipCommand } from "./coinflip.command.ts";
import { renderHelp } from "./help.command.ts";

import { emojiMap } from "../../shared/emojis/emoji-cache.ts";

beforeEach(() => {
  randomInt.mockReset();
  emojiMap.set("coinflip_1", { name: "coinflip_1", id: "111" } as Emoji);
  emojiMap.set("coinflip_2", { name: "coinflip_2", id: "222" } as Emoji);
});
afterEach(() => emojiMap.clear());

describe("/coinflip", () => {
  it("registers a command without options or permission requirements and includes it in help", () => {
    expect(commands).toContain(coinflipCommand);
    const data = coinflipCommand.data.toJSON();
    expect(data.name).toBe("coinflip");
    expect(data.options).toHaveLength(0);
    expect(data.default_member_permissions).toBeUndefined();
    expect(JSON.stringify(renderHelp(commands))).toContain("/coinflip");
  });

  it.each([
    { value: 0, outcome: "Heads", emoji: "<:coinflip_1:111>" },
    { value: 1, outcome: "Tails", emoji: "<:coinflip_2:222>" },
  ])("returns $outcome for secure random value $value", async ({ value, outcome, emoji }) => {
    randomInt.mockReturnValueOnce(value);
    const reply = vi.fn();
    await coinflipCommand.execute({ reply } as unknown as ChatInputCommandInteraction);
    expect(randomInt).toHaveBeenCalledExactlyOnceWith(0, 2);
    expect(reply).toHaveBeenCalledExactlyOnceWith({
      content: `# ${emoji} **${outcome}**`,
      allowedMentions: { parse: [] },
    });
  });

  it("draws a fresh result for every invocation", async () => {
    randomInt.mockReturnValueOnce(0).mockReturnValueOnce(1);
    const reply = vi.fn();
    const interaction = { reply } as unknown as ChatInputCommandInteraction;
    await coinflipCommand.execute(interaction);
    await coinflipCommand.execute(interaction);
    expect(randomInt).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ content: "# <:coinflip_1:111> **Heads**" }),
    );
    expect(reply).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ content: "# <:coinflip_2:222> **Tails**" }),
    );
  });

  it("does not invent a result when secure randomness fails", async () => {
    randomInt.mockImplementationOnce(() => {
      throw new Error("Random source unavailable");
    });
    const reply = vi.fn();
    await expect(
      coinflipCommand.execute({ reply } as unknown as ChatInputCommandInteraction),
    ).rejects.toThrow("Random source unavailable");
    expect(reply).not.toHaveBeenCalled();
  });
});

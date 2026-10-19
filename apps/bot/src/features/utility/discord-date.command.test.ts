import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationCommandOptionType,
  MessageFlags,
  TimestampStyles,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "@/core/command-registry.ts";
import { discordDateCommand } from "./discord-date.command.ts";
import { renderHelp } from "./help.command.ts";

function fixture(
  date = "25/12/2026 18:30",
  utc: number | null = null,
  format: string | null = null,
) {
  return {
    options: {
      getString: vi.fn((name: string) => (name === "date" ? date : format)),
      getNumber: vi.fn(() => utc),
    },
    deferReply: vi.fn(async (_options: unknown) => {}),
    editReply: vi.fn(async (_options: unknown) => {}),
    deleteReply: vi.fn(async () => {}),
  };
}
const execute = (interaction: ReturnType<typeof fixture>) =>
  discordDateCommand.execute(interaction as unknown as ChatInputCommandInteraction);
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("/discord-date", () => {
  it("registers exactly three options, with only date required, and exposes all TimestampStyles", () => {
    expect(commands).toContain(discordDateCommand);
    const data = discordDateCommand.data.toJSON();
    expect(data.name).toBe("discord-date");
    expect(data.options).toMatchObject([
      { name: "date", type: ApplicationCommandOptionType.String, required: true },
      { name: "utc", type: ApplicationCommandOptionType.Number, min_value: -12, max_value: 14 },
      { name: "format", type: ApplicationCommandOptionType.String },
    ]);
    expect(data.options).toHaveLength(3);
    expect(data.options?.slice(1).every((option) => !option.required)).toBe(true);
    const format = data.options?.[2];
    if (format?.type !== ApplicationCommandOptionType.String)
      throw new Error("Expected format option");
    expect(format.choices?.map(({ value }) => value)).toEqual(Object.values(TimestampStyles));
    expect(data.default_member_permissions).toBeUndefined();
    expect(JSON.stringify(renderHelp(commands))).toContain("/discord-date");
  });
  it("defaults to UTC 0 and full date/time, replying privately with a visual and copyable code", async () => {
    vi.useFakeTimers();
    const request = fixture();
    await execute(request);
    expect(request.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(request.editReply).toHaveBeenCalledWith({
      content: "**Preview**\n<t:1798223400:F>\n\n**Copy/paste**\n```\n<t:1798223400:F>\n```",
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(request.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request.deleteReply).toHaveBeenCalledOnce();
  });
  it.each(Object.values(TimestampStyles))(
    "renders the selected %s style and applies the UTC offset",
    async (format) => {
      vi.useFakeTimers();
      const request = fixture("25/12/2026 18:30", 5.5, format);
      await execute(request);
      expect(request.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: `**Preview**\n<t:1798203600:${format}>\n\n**Copy/paste**\n\`\`\`\n<t:1798203600:${format}>\n\`\`\``,
        }),
      );
    },
  );
  it("starts the 30-second timer only after the result has been displayed", async () => {
    vi.useFakeTimers();
    const request = fixture();
    let display!: () => void;
    request.editReply.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          display = resolve;
        }),
    );
    const pending = execute(request);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request.deleteReply).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    display();
    await pending;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(request.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request.deleteReply).toHaveBeenCalledOnce();
  });
  it("ignores deletion errors if the user has already dismissed the result", async () => {
    vi.useFakeTimers();
    const request = fixture();
    request.deleteReply.mockRejectedValueOnce(new Error("Unknown Message"));
    await execute(request);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(request.deleteReply).toHaveBeenCalledOnce();
  });
  it.each([
    ["31/02/2026", 0, "F"],
    ["not a date", 0, "F"],
    ["25/12/2026", 15, "F"],
    ["25/12/2026", 0, "invalid"],
  ] as const)("rejects invalid input without publishing a result", async (date, utc, format) => {
    const request = fixture(date, utc, format);
    await expect(execute(request)).rejects.toThrow();
    expect(request.deferReply).not.toHaveBeenCalled();
    expect(request.editReply).not.toHaveBeenCalled();
  });
});

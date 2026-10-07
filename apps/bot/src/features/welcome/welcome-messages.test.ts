import { describe, expect, it } from "vitest";
import { SeparatorSpacingSize } from "discord.js";
import { createWelcomeMessageContainer, DEFAULT_ARRIVAL_MESSAGE } from "./welcome-messages.ts";

const render = (text: string) => createWelcomeMessageContainer(text, true).toJSON();

describe("welcome message components", () => {
  it("preserves the requested default template including Markdown line breaks", () => {
    expect(DEFAULT_ARRIVAL_MESSAGE).toBe(
      "# 👋 Welcome to {server}!\n\nHey **{user}**, welcome!  \nWe're glad to have you here.\n\nTake a moment to explore the server and set things up the way you like.\n\n---\n\n📖 **Rules**  \nCheck out the server rules before jumping in.\n\n💬 **Community**  \nJoin the conversation, meet other members, and have fun!\n\n---\n\n✨ You're our **{memberCount}th member**.  \nEnjoy your stay!",
    );
  });
  it("converts standalone separators, including CRLF and surrounding whitespace", () => {
    expect(render("First\r\n  --- \r\nSecond").components).toEqual([
      { type: 10, content: "First" },
      { type: 14, divider: true, spacing: SeparatorSpacingSize.Large },
      { type: 10, content: "Second" },
    ]);
  });
  it("preserves inline dashes and avoids empty text displays at edge or consecutive separators", () => {
    expect(render("One --- two").components).toEqual([{ type: 10, content: "One --- two" }]);
    expect(render("---\nText\n---\n---").components.map((component) => component.type)).toEqual([
      14, 10, 14, 14,
    ]);
  });
  it("rejects empty or separator-only messages", () => {
    expect(() => render(" \n")).toThrow("must contain text");
    expect(() => render("---\n---")).toThrow("must contain text");
  });
  it("enforces the total Discord component limit including the container", () => {
    expect(render(Array(20).fill("text").join("\n---\n")).components).toHaveLength(39);
    expect(() => render(Array(21).fill("text").join("\n---\n"))).toThrow("Too many");
  });
  it("supports separators on departure messages with the departure accent", () => {
    expect(createWelcomeMessageContainer("Bye\n---\nTake care", false).toJSON()).toMatchObject({
      accent_color: 0x95a5a6,
      components: [{ type: 10 }, { type: 14 }, { type: 10 }],
    });
  });
});

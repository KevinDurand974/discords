import { describe, expect, it } from "vitest";
import { ButtonStyle, ComponentType, SeparatorSpacingSize } from "discord.js";
import { DEFAULT_RULES } from "./default-rules.ts";
import { createRuleComponents } from "./rule-components.ts";

const render = (rules: string) => createRuleComponents(rules)[0]!.toJSON();

describe("rules Components V2", () => {
  it("renders the default rules in a container with a real divider before Remember", () => {
    const [before, after] = DEFAULT_RULES.split("\n---\n");
    expect(render(DEFAULT_RULES)).toMatchObject({
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: before!.trim() },
        { type: ComponentType.Separator, divider: true },
        { type: ComponentType.TextDisplay, content: after!.trim() },
      ],
    });
  });

  it("converts every standalone separator, including CRLF and surrounding spaces", () => {
    expect(render("First\r\n --- \r\nSecond\n---\nThird").components).toMatchObject([
      { type: ComponentType.TextDisplay, content: "First" },
      { type: ComponentType.Separator, divider: true },
      { type: ComponentType.TextDisplay, content: "Second" },
      { type: ComponentType.Separator, divider: true },
      { type: ComponentType.TextDisplay, content: "Third" },
    ]);
  });

  it("adds large spacing above and below every separator", () => {
    const separators = render("First\n---\nSecond\n---\nThird").components.filter(
      (component) => component.type === ComponentType.Separator,
    );
    expect(separators).toHaveLength(2);
    separators.forEach((separator) => {
      expect(separator).toMatchObject({ divider: true, spacing: SeparatorSpacingSize.Large });
    });
  });

  it("does not interpret inline dashes as separators", () => {
    expect(render("Use --- only on its own line").components).toMatchObject([
      { type: ComponentType.TextDisplay, content: "Use --- only on its own line" },
    ]);
  });

  it("avoids empty text displays next to consecutive or edge separators", () => {
    expect(render("---\nFirst\n---\n---\n").components).toMatchObject([
      { type: ComponentType.Separator },
      { type: ComponentType.TextDisplay, content: "First" },
      { type: ComponentType.Separator },
      { type: ComponentType.Separator },
    ]);
  });

  it("adds a green acceptance button in an ActionRow beneath the rules", () => {
    expect(
      createRuleComponents("Rules", { guildId: "100", roleId: "200" })[0]!.toJSON(),
    ).toMatchObject({
      type: ComponentType.Container,
      components: [
        { type: ComponentType.TextDisplay, content: "Rules" },
        {
          type: ComponentType.ActionRow,
          components: [
            {
              type: ComponentType.Button,
              style: ButtonStyle.Success,
              label: "I understand and agree",
              custom_id: "rule-accept:100:200",
            },
          ],
        },
      ],
    });
  });

  it("reserves components for the acceptance button and row", () => {
    const acceptance = { guildId: "100", roleId: "200" };
    expect(
      createRuleComponents(
        Array.from({ length: 19 }, () => "Section").join("\n---\n"),
        acceptance,
      )[0]!.toJSON().components,
    ).toHaveLength(38);
    expect(() =>
      createRuleComponents(Array.from({ length: 20 }, () => "Section").join("\n---\n"), acceptance),
    ).toThrow("Too many rule sections");
  });

  it("rejects separator-only input", () => {
    expect(() => render("---\n---")).toThrow("must contain text");
  });

  it("enforces the 40-component message limit including the container", () => {
    expect(
      render(Array.from({ length: 20 }, () => "Section").join("\n---\n")).components,
    ).toHaveLength(39);
    expect(() => render(Array.from({ length: 21 }, () => "Section").join("\n---\n"))).toThrow(
      "Too many rule sections",
    );
  });
});

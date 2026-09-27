import { expect, it } from "vitest";
import { splitDiscordText, toDiscordMarkdown } from "./discord-markdown.ts";

it("converts simple news HTML to Discord Markdown and drops unsafe links", () => {
  const text = toDiscordMarkdown(
    '<h2>Update</h2><p>New <strong>hunter</strong><br><em>today</em> <a href="https://example.com/news">details</a> <a href="javascript:alert(1)">bad</a> <a href="/slv_en/view/32/109472">source</a></p><ul><li>First</li><li>Second</li></ul><script>evil</script>',
    null,
  );
  expect(text).toContain("**Update**");
  expect(text).toContain("**hunter**");
  expect(text).toContain("_today_");
  expect(text).toContain("[details](https://example.com/news)");
  expect(text).toContain("[source](https://forum.netmarble.com/slv_en/view/32/109472)");
  expect(text).toContain("bad");
  expect(text).not.toContain("javascript:");
  expect(text).not.toContain("evil");
  expect(text).toMatch(/First[\s\S]*Second/);
});

it("splits text into Discord-sized detail messages", () => {
  const parts = splitDiscordText("A long paragraph. ".repeat(300));
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((part) => part.length <= 1900)).toBe(true);
  expect(toDiscordMarkdown(null, "Fallback")).toBe("Fallback");
});

it("keeps long links and formatted spans readable without broken Markdown across messages", () => {
  const text = `**${"Long article text ".repeat(30)}** [Read more](https://example.com/a-b?q=1)`;
  const parts = splitDiscordText(text, 100);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((part) => part.length <= 100 && !part.endsWith("\\"))).toBe(true);
  const content = parts.join("").replace(/\\([\\`*_{}()#+.!>|~-]|\[|\])/g, "$1");
  expect(content).toContain("Long article text ");
  expect(content).toContain("Read more (https://example.com/a-b?q=1)");
  expect(content).not.toContain("[Read more](");
});

it("renders code and tables as readable Discord text", () => {
  const text = toDiscordMarkdown(
    "<pre><code>const a = `safe`;</code></pre><table><tr><th>Stat</th><th>Value</th></tr><tr><td>ATK</td><td>100</td></tr></table>",
    null,
  );
  expect(text).toContain("```\nconst a = `safe`;\n```");
  expect(text).toContain("Stat | Value\nATK | 100");
});

it("drops unsafe HTML and prevents mentions from article text", () => {
  const text = toDiscordMarkdown(
    '<p>@everyone <a href="data:text/html,bad">not a link</a> <img src="https://example.com/p.png"></p><iframe>unsafe</iframe>',
    null,
  );
  expect(text).toContain("@\u200beveryone");
  expect(text).not.toContain("data:");
  expect(text).not.toContain("unsafe");
  expect(text).not.toContain("p.png");
});

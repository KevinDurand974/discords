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

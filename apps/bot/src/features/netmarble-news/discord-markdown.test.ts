import { expect, it } from "vitest";
import { renderArticleParts, splitDiscordText, toDiscordMarkdown } from "./discord-markdown.ts";

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

it("keeps images between the HTML text blocks rather than moving them to the end", () => {
  expect(renderArticleParts('<p>Before</p><img src="/a.png"><p>After</p>', null)).toEqual([
    { type: "text", content: "Before" },
    { type: "image", url: "https://forum.netmarble.com/a.png" },
    { type: "text", content: "After" },
  ]);
  expect(renderArticleParts(null, "Fallback")).toEqual([{ type: "text", content: "Fallback" }]);
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

it("turns table rows into ordered embed parts without generated column labels", () => {
  const parts = renderArticleParts(
    "<p>Before</p><hr><table><tr><th>Stat</th><th>Value</th></tr><tr><td>ATK</td><td><strong>100</strong></td></tr><tr><td>DEF</td><td><code>20</code></td></tr></table><p>After</p>",
    null,
  );
  expect(parts).toEqual([
    { type: "text", content: "Before" },
    { type: "tableRow", header: true, columns: ["Stat", "Value"], images: [] },
    { type: "tableRow", header: false, columns: ["ATK", "**100**"], images: [] },
    { type: "tableRow", header: false, columns: ["DEF", "`20`"], images: [] },
    { type: "text", content: "After" },
  ]);
  expect(toDiscordMarkdown("<table><tr><td>A</td><td>B</td></tr></table>", null)).toBe("A  •  B");
});

it("recognizes styled td headers from the source tables", () => {
  expect(
    renderArticleParts(
      "<table><tr><td>Category</td><td>Changed</td></tr><tr><td>Skill</td><td>Effect</td></tr></table>",
      null,
    ),
  ).toEqual([
    { type: "tableRow", header: true, columns: ["Category", "Changed"], images: [] },
    { type: "tableRow", header: false, columns: ["Skill", "Effect"], images: [] },
  ]);
});

it("groups rows sharing a rowspan and retains right-hand items for a V2 list", () => {
  expect(
    renderArticleParts(
      '<table><tr><td rowspan="3">Shared</td><td>First</td></tr><tr><td>Second</td></tr><tr><td>Third</td></tr><tr><td>Other</td><td>Fourth</td></tr></table>',
      null,
    ),
  ).toEqual([
    {
      type: "tableRow",
      header: false,
      columns: ["Shared", "First\nSecond\nThird"],
      images: [],
      rightRows: ["First", "Second", "Third"],
    },
    { type: "tableRow", header: false, columns: ["Other", "Fourth"], images: [] },
  ]);
});

it("retains safe links and inline images inside table cells", () => {
  const parts = renderArticleParts(
    '<table><tr><th>Reward</th><th>Item</th></tr><tr><td><a href="/reward">Details</a></td><td><img src="/prize.png">Prize</td></tr></table>',
    null,
  );
  expect(parts).toEqual([
    { type: "tableRow", header: true, columns: ["Reward", "Item"], images: [] },
    {
      type: "tableRow",
      header: false,
      columns: ["[Details](https://forum.netmarble.com/reward)", "Prize"],
      images: ["https://forum.netmarble.com/prize.png"],
    },
  ]);
});

it("formats note prefixes and pin spacing for Discord", () => {
  const text = toDiscordMarkdown(
    "<p>Opening</p><p>📌 Important</p><p>※ Caution</p><p>* Footnote</p>",
    null,
  );
  expect(text).toContain("Opening\n\n\n## 📌 Important");
  expect(
    toDiscordMarkdown("<h2>📌 Heading</h2><p><strong>📌 Bold pin</strong></p>", null),
  ).toContain("## 📌 Heading\n\n\n## 📌 Bold pin");
  expect(renderArticleParts("<p>📌 Important</p>", null)).toEqual([
    { type: "text", content: "## 📌 Important" },
  ]);
  expect(text).toContain("> ※ Caution");
  expect(text).toContain("-# Footnote");
  expect(toDiscordMarkdown("<p>First</p><hr><p>Second</p>", null)).toBe("First\nSecond");
  expect(renderArticleParts("<p>※ Caution</p><p>* Footnote</p>", null)).toEqual([
    { type: "text", content: "> ※ Caution\n\n-# Footnote" },
  ]);
});

it("preserves Discord strikethrough, fenced code and highlighted text", () => {
  const text = toDiscordMarkdown(
    "<p><mark>Important</mark> <del>Expired</del></p><pre><code>const a = `safe`;</code></pre>",
    null,
  );
  expect(text).toContain("**Important**");
  expect(text).toContain("~~Expired~~");
  expect(text).toContain("```\nconst a = `safe`;\n```");
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

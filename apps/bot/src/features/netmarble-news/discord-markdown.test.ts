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

it("decodes entities in fallback text without interpreting it as HTML", () => {
  const fallback = "<Update> &amp; &quot;Rewards&quot; &#39;Today&#39; &copy;";
  const expected = "<Update> & \"Rewards\" 'Today' ©";
  expect(toDiscordMarkdown(null, fallback)).toBe(expected);
  expect(renderArticleParts(null, fallback)).toEqual([{ type: "text", content: expected }]);
  expect(toDiscordMarkdown("<p></p>", fallback)).toBe(expected);
});

it("decodes HTML body entities exactly once", () => {
  expect(toDiscordMarkdown("<p>A &amp; B &amp;lt;literal&amp;gt;</p>", null)).toBe(
    "A & B &lt;literal&gt;",
  );
});

it.each([
  "<h2>📢<strong>9/17 (Thu) Update Details</strong></h2>",
  "<h2><strong>📢9/17 (Thu) Update Details</strong></h2>",
  "<p><strong>📢<b>9/17 (Thu) Update Details</b></strong></p>",
  "<h2>📢<span><mark>9/17 (Thu) Update Details</mark></span></h2>",
])("avoids nested bold delimiters in announcement headings: %s", (html) => {
  expect(toDiscordMarkdown(html, null)).toBe("**📢9/17 (Thu) Update Details**");
  expect(renderArticleParts(html, null)).toEqual([
    { type: "text", content: "**📢9/17 (Thu) Update Details**" },
  ]);
});

it("keeps pin-heading emphasis and literal asterisks inside code intact", () => {
  expect(toDiscordMarkdown("<h2>📌<strong>Notes</strong></h2>", null)).toBe("## 📌**Notes**");
  expect(toDiscordMarkdown("<h2><strong>📌Notes</strong></h2>", null)).toBe("## 📌Notes");
  expect(toDiscordMarkdown("<h2>📢<strong>Code <code>**literal**</code></strong></h2>", null)).toBe(
    "**📢Code `**literal**`**",
  );
  expect(toDiscordMarkdown("<p>📢<strong>9/17 (Thu) Update Details</strong></p>", null)).toBe(
    "📢**9/17 (Thu) Update Details**",
  );
});

it("preserves quote markers already present in source text", () => {
  expect(toDiscordMarkdown("<p>&gt; ※ Caution</p>", null)).toBe("> ※ Caution");
});

it("preserves quotes, hyperlinks and bold pin labels in long article parts", () => {
  const url = "https://forum.netmarble.com/slv_en/view/32/109604/";
  const parts = renderArticleParts(
    `<p>${"Article paragraph. ".repeat(110)}</p><p>※ Caution</p><p><a href="${url}">Notice: Guild Boss Rage Score Fix and Normalization</a></p><p>📌<strong>Notes</strong></p>`,
    null,
  );
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n");
  expect(text).toContain("> ※ Caution");
  expect(text).toContain(`[Notice: Guild Boss Rage Score Fix and Normalization](${url})`);
  expect(text).toContain("**Notes**");
  expect(text).not.toContain("\\> ※");
  expect(text).not.toContain("\\*\\*Notes");
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
  expect(content).toContain("[Read more](https://example.com/a-b?q=1)");
});

it("repeats quote prefixes and closes bold spans when a single note is oversized", () => {
  const parts = splitDiscordText(`> ※ **${"Important note ".repeat(30)}**`, 100);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.every((part) => part.length <= 100 && part.startsWith("> "))).toBe(true);
  expect(
    parts
      .filter((part) => part.includes("Important"))
      .every((part) => part.match(/\*\*/g)?.length === 2),
  ).toBe(true);
});

it("splits oversized fenced code with balanced fences and preserves indentation", () => {
  const code = "  const value = 1;\n".repeat(20);
  const parts = splitDiscordText(`\`\`\`js\n${code}\`\`\``, 100);
  expect(
    parts.every(
      (part) => part.length <= 100 && part.startsWith("```js\n") && part.endsWith("\n```"),
    ),
  ).toBe(true);
  expect(parts.map((part) => part.slice(6, -4)).join("")).toBe(code.slice(0, -1));
});

it("keeps escaped link labels and parentheses in link destinations intact", () => {
  const html = `<p>${"Text. ".repeat(350)}</p><p><a href="https://example.com/a_(b)">[Notice]</a></p>`;
  const text = renderArticleParts(html, null)
    .filter((part) => part.type === "text")
    .map((part) => part.content)
    .join("\n");
  expect(text).toContain("[\\[Notice\\]](https://example.com/a_%28b%29)");
  expect(text).not.toContain("https://example\\.com");
});

it("keeps escape pairs and Unicode characters intact at message boundaries", () => {
  const parts = splitDiscordText("🎉".repeat(20) + "\\*".repeat(20), 9);
  expect(parts.every((part) => part.length <= 9 && !part.endsWith("\\"))).toBe(true);
  expect(parts.join("")).toBe("🎉".repeat(20) + "\\*".repeat(20));
  expect(() => splitDiscordText("text", 2)).toThrow(RangeError);
});

it("turns table rows into ordered embed parts without generated column labels", () => {
  const parts = renderArticleParts(
    "<p>Before</p><hr><table><tr><th>Stat</th><th>Value</th></tr><tr><td>ATK</td><td><strong>100</strong></td></tr><tr><td>DEF</td><td><code>20</code></td></tr></table><p>After</p>",
    null,
  );
  expect(parts).toEqual([
    { type: "text", content: "Before" },
    { type: "tableRow", header: true, tableStart: true, columns: ["Stat", "Value"], images: [] },
    { type: "tableRow", header: false, columns: ["ATK", "**100**"], images: [] },
    { type: "tableRow", header: false, columns: ["DEF", "`20`"], images: [] },
    { type: "text", content: "After" },
  ]);
  expect(toDiscordMarkdown("<table><tr><td>A</td><td>B</td></tr></table>", null)).toBe("A  •  B");
});

it("marks each table boundary so headers cannot leak into the next table", () => {
  expect(
    renderArticleParts(
      "<table><tr><td>First</td></tr><tr><td>Second</td></tr></table><table><tr><td>Third</td></tr></table>",
      null,
    ),
  ).toEqual([
    { type: "tableRow", header: false, tableStart: true, columns: ["First"], images: [] },
    { type: "tableRow", header: false, columns: ["Second"], images: [] },
    { type: "tableRow", header: false, tableStart: true, columns: ["Third"], images: [] },
  ]);
});

it("recognizes styled td headers from the source tables", () => {
  expect(
    renderArticleParts(
      "<table><tr><td>Category</td><td>Changed</td></tr><tr><td>Skill</td><td>Effect</td></tr></table>",
      null,
    ),
  ).toEqual([
    {
      type: "tableRow",
      header: true,
      tableStart: true,
      columns: ["Category", "Changed"],
      images: [],
    },
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
      tableStart: true,
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
    { type: "tableRow", header: true, tableStart: true, columns: ["Reward", "Item"], images: [] },
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

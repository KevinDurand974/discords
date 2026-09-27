import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
const escape = turndown.escape.bind(turndown);
turndown.escape = (text) => escape(text).replace(/@/g, "@\u200b").replace(/[|`]/g, "\\$&");
turndown.addRule("discordHeadings", {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
  replacement: (content) => `\n\n**${content.trim()}**\n\n`,
});
turndown.addRule("discordCodeBlock", {
  filter: "pre",
  replacement: (_content, node) => {
    const code = (node.textContent ?? "").trimEnd();
    const longestRun = Math.max(0, ...Array.from(code.matchAll(/`+/g), ([run]) => run.length));
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    return `\n\n${fence}\n${code}\n${fence}\n\n`;
  },
});
type HtmlNode = {
  querySelectorAll(selector: string): ArrayLike<HtmlNode>;
  textContent: string | null;
};
turndown.addRule("discordTable", {
  filter: "table",
  replacement: (_content, node) => {
    const rows = Array.from((node as HtmlNode).querySelectorAll("tr"));
    return `\n\n${rows
      .map((row) =>
        Array.from(row.querySelectorAll("th,td"))
          .map((cell) =>
            turndown
              .escape(cell.textContent?.trim() ?? "")
              .replace(/@/g, "@\u200b")
              .replace(/\|/g, "\\|"),
          )
          .join(" | "),
      )
      .join("\n")}\n\n`;
  },
});
turndown.addRule("safeLinks", {
  filter: "a",
  replacement: (content, node) => {
    const href = (node as { getAttribute(name: string): string | null }).getAttribute("href");
    if (!href) return content;
    try {
      const url = new URL(href, "https://forum.netmarble.com");
      return ["http:", "https:"].includes(url.protocol)
        ? `[${content
            .replace(/[\\`|]/g, "\\$&")
            .replaceAll("[", "\\[")
            .replaceAll("]", "\\]")
            .replace(/@/g, "@\u200b")}](${url.toString().replaceAll(")", "%29")})`
        : content;
    } catch {
      return content;
    }
  },
});
// Media is imported separately in Phase 6, not rendered as remote image links here.
turndown.addRule("dropMedia", {
  filter: ["img", "video", "audio", "source"],
  replacement: () => "",
});
turndown.remove(["script", "style", "iframe", "form", "noscript"]);

export function toDiscordMarkdown(html: string | null, fallback: string | null): string {
  const text = html
    ? turndown
        .turndown(html)
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "";
  return (
    text || fallback?.trim() || "No article text available. Read the full article on Netmarble."
  );
}

// For long articles, use escaped plain text so no Markdown link/emphasis/code span
// can be split across Discord messages. Keep link destinations visible as text.
export function splitDiscordText(text: string, limit = 1900): string[] {
  if (limit < 3) throw new RangeError("The message limit must be at least 3.");
  const remaining = text.trim();
  if (remaining.length <= limit) return remaining ? [remaining] : [];
  const plain = remaining
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
    .replace(/\\([\\`*_{}()#+.!>|~-]|\[|\])/g, "$1")
    .replace(/(?:\*\*|__|~~|`)/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/@/g, "@\u200b")
    .replace(/[\\`*_{}()#+.!>|~-]|\[|\]/g, "\\$&");
  const units = plain.match(/\\[\s\S]|[\s\S]/gu) ?? [];
  const { messages, current } = units.reduce<{ messages: string[]; current: string }>(
    (state, unit) =>
      state.current.length + unit.length > limit
        ? { messages: [...state.messages, state.current], current: unit }
        : { ...state, current: state.current + unit },
    { messages: [], current: "" },
  );
  return current ? [...messages, current] : messages;
}

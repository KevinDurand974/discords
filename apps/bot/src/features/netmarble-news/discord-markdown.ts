import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
turndown.addRule("discordHeadings", {
  filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
  replacement: (content) => `\n\n**${content.trim()}**\n\n`,
});
turndown.addRule("safeLinks", {
  filter: "a",
  replacement: (content, node) => {
    const href = (node as { getAttribute(name: string): string | null }).getAttribute("href");
    if (!href) return content;
    try {
      const url = new URL(href, "https://forum.netmarble.com");
      return ["http:", "https:"].includes(url.protocol)
        ? `[${content.replaceAll("]", "\\]")}](${url.toString().replaceAll(")", "%29")})`
        : content;
    } catch {
      return content;
    }
  },
});
// Media is imported separately in Phase 6, not rendered as remote image links here.
turndown.remove(["script", "style", "iframe", "form", "noscript", "img"]);

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

// Split at paragraph/word boundaries where possible; full Markdown-aware splitting is Phase 5.
export function splitDiscordText(text: string, limit = 1900): string[] {
  if (limit < 1) throw new RangeError("The message limit must be positive.");
  const remaining = text.trim();
  if (remaining.length <= limit) return remaining ? [remaining] : [];
  const paragraph = remaining.lastIndexOf("\n\n", limit);
  const newline = remaining.lastIndexOf("\n", limit);
  const space = remaining.lastIndexOf(" ", limit);
  const boundary = [paragraph, newline, space].find((index) => index > limit / 2) ?? limit;
  return [
    remaining.slice(0, boundary).trim(),
    ...splitDiscordText(remaining.slice(boundary), limit),
  ];
}

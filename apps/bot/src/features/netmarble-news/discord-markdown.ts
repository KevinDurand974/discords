import TurndownService from "turndown";
import { decodeHTML } from "entities";

function createTurndown(
  onImage?: (url: string) => string,
  onTableRow?: (
    columns: string[],
    header: boolean,
    rightRows: string[],
    tableStart: boolean,
  ) => string,
) {
  const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-" });
  const escape = turndown.escape.bind(turndown);
  turndown.escape = (text) => escape(text).replace(/@/g, "@\u200b").replace(/[|`]/g, "\\$&");
  type FormattingNode = {
    nodeName: string;
    textContent: string | null;
    parentNode: FormattingNode | null;
  };
  const hasBoldAncestor = (node: FormattingNode | null): boolean =>
    node !== null &&
    (["STRONG", "B", "MARK"].includes(node.nodeName) ||
      (/^H[1-6]$/.test(node.nodeName) && !(node.textContent ?? "").trimStart().startsWith("📌")) ||
      hasBoldAncestor(node.parentNode));
  turndown.addRule("discordBold", {
    filter: ["strong", "b", "mark"],
    replacement: (content, node) =>
      !content.trim() || hasBoldAncestor((node as FormattingNode).parentNode)
        ? content
        : `**${content}**`,
  });
  turndown.addRule("discordHeadings", {
    filter: ["h1", "h2", "h3", "h4", "h5", "h6"],
    replacement: (content, node) =>
      (node.textContent ?? "").trimStart().startsWith("📌")
        ? `\n\n${content.trim()}\n\n`
        : `\n\n**${content.trim()}**\n\n`,
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
    innerHTML: string;
    tagName: string;
    getAttribute(name: string): string | null;
  };
  turndown.addRule("discordTable", {
    filter: "table",
    replacement: (_content, node) => {
      const rows = Array.from((node as HtmlNode).querySelectorAll("tr"));
      const cells = (row: HtmlNode) => Array.from(row.querySelectorAll("th,td"));
      const groups: string[] = [];
      const occupiedUntil = new Map<number, number>();
      let groupEnd = -1;
      let groupedColumns: string[][] = [];
      let header = false;
      const flush = () => {
        const columns = groupedColumns.map((values) => values.join("\n"));
        groups.push(
          onTableRow
            ? onTableRow(columns, header, groupedColumns[1] ?? [], groups.length === 0)
            : columns.filter((column) => column.trim()).join("  •  "),
        );
        groupedColumns = [];
      };
      rows.forEach((row, rowIndex) => {
        if (rowIndex > groupEnd && groupedColumns.length) flush();
        const rowCells = cells(row);
        if (!groupedColumns.length) {
          const labels = rowCells.map((cell) => (cell.textContent ?? "").trim().toLowerCase());
          header =
            rowIndex === 0 &&
            rowCells.length > 1 &&
            (rowCells.every((cell) => cell.tagName === "TH") ||
              (labels[0] === "category" && labels[1] === "changed") ||
              (labels[0]?.startsWith("reward claim period") === true &&
                labels[1] === "reward details"));
        }
        let column = 0;
        for (const cell of rowCells) {
          while ((occupiedUntil.get(column) ?? 0) > rowIndex) column += 1;
          const rowSpan = Math.max(
            1,
            Number.parseInt(cell.getAttribute("rowspan") ?? "1", 10) || 1,
          );
          const colSpan = Math.max(
            1,
            Number.parseInt(cell.getAttribute("colspan") ?? "1", 10) || 1,
          );
          (groupedColumns[column] ??= []).push(turndown.turndown(cell.innerHTML).trim());
          for (let offset = 0; offset < colSpan; offset++)
            occupiedUntil.set(column + offset, rowIndex + rowSpan);
          groupEnd = Math.max(groupEnd, rowIndex + rowSpan - 1);
          column += colSpan;
        }
      });
      if (groupedColumns.length) flush();
      return `\n\n${groups.join("\n\n")}\n\n`;
    },
  });
  turndown.addRule("discordHorizontalRule", {
    filter: "hr",
    replacement: () => "\uE004",
  });
  turndown.addRule("discordStrikethrough", {
    filter: ["s", "strike", "del"],
    replacement: (content) => `~~${content.trim()}~~`,
  });
  turndown.addRule("safeLinks", {
    filter: "a",
    replacement: (content, node) => {
      const href = (node as { getAttribute(name: string): string | null }).getAttribute("href");
      if (!href) return content;
      try {
        const url = new URL(href, "https://forum.netmarble.com");
        return ["http:", "https:"].includes(url.protocol)
          ? `[${content}](${url.toString().replaceAll("(", "%28").replaceAll(")", "%29")})`
          : content;
      } catch {
        return content;
      }
    },
  });
  turndown.addRule("inlineImages", {
    filter: "img",
    replacement: (_content, node) => {
      const image = node as { getAttribute(name: string): string | null };
      const url = image.getAttribute("src") ?? image.getAttribute("data-src");
      return url && onImage ? `\n\n${onImage(url)}\n\n` : "";
    },
  });
  turndown.addRule("dropMedia", {
    filter: ["video", "audio", "source"],
    replacement: () => "",
  });
  turndown.remove(["script", "style", "iframe", "form", "noscript"]);
  return turndown;
}

function formatArticleText(text: string): string {
  return text
    .replace(/\n*\uE004\n*/g, "\n")
    .replace(/^\*\*(📌[^\n]*?)\*\*$/gm, "$1")
    .replace(/(?:\n[ \t]*)+📌/g, "\n\n\n📌")
    .replace(/^📌/gm, "## 📌")
    .replace(/^(?:\\?>[ \t]*)?※[ \t]*/gm, "> ※ ")
    .replace(/^\\?\*(?!\*)\s*/gm, "-# ");
}

export function toDiscordMarkdown(html: string | null, fallback: string | null): string {
  const text = html
    ? createTurndown()
        .turndown(html)
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    : "";
  return formatArticleText(
    text ||
      decodeHTML(fallback ?? "").trim() ||
      "No article text available. Read the full article on Netmarble.",
  );
}

export type ArticlePart =
  | { type: "text"; content: string }
  | { type: "image"; url: string }
  | {
      type: "tableRow";
      header: boolean;
      tableStart?: true;
      columns: string[];
      images: string[];
      rightRows?: string[];
    };

export function renderArticleParts(html: string | null, fallback: string | null): ArticlePart[] {
  const images: string[] = [];
  const rows: { columns: string[]; header: boolean; rightRows: string[]; tableStart: boolean }[] =
    [];
  const markdown = html
    ? createTurndown(
        (url) => {
          try {
            images.push(new URL(url, "https://forum.netmarble.com").toString());
          } catch {
            return "";
          }
          return `\uE000${images.length - 1}\uE001`;
        },
        (columns, header, rightRows, tableStart) => {
          rows.push({ columns, header, rightRows, tableStart });
          return `\uE002${rows.length - 1}\uE003`;
        },
      ).turndown(html)
    : "";
  if (!images.length && !rows.length)
    return splitDiscordText(
      formatArticleText(markdown.trim() || toDiscordMarkdown(null, fallback)),
    ).map((content) => ({ type: "text", content }));
  return markdown.split(/(\uE000\d+\uE001|\uE002\d+\uE003)/g).flatMap((part): ArticlePart[] => {
    const image = /^\uE000(\d+)\uE001$/.exec(part);
    if (image) return [{ type: "image", url: images[Number(image[1])]! }];
    const row = /^\uE002(\d+)\uE003$/.exec(part);
    if (row) {
      const rowData = rows[Number(row[1])]!;
      const rowImages: string[] = [];
      const columns = rowData.columns.map((cell) =>
        cell
          .replace(/\uE000(\d+)\uE001/g, (_, index: string) => {
            rowImages.push(images[Number(index)]!);
            return "";
          })
          .trim(),
      );
      const rightRows = rowData.rightRows.map((cell) =>
        cell.replace(/\uE000\d+\uE001/g, "").trim(),
      );
      return [
        {
          type: "tableRow",
          header: rowData.header,
          ...(rowData.tableStart ? { tableStart: true as const } : {}),
          columns,
          images: rowImages,
          ...(rightRows.length > 1 ? { rightRows } : {}),
        },
      ];
    }
    return splitDiscordText(formatArticleText(part.trim())).map((content) => ({
      type: "text",
      content,
    }));
  });
}

function packTextUnits(units: string[], limit: number, trim = true): string[] {
  const messages: string[] = [];
  let current = "";
  units.forEach((unit) => {
    if (current.length + unit.length > limit) {
      if (current) messages.push(trim ? current.trim() : current);
      current = "";
    }
    current += current || !trim ? unit : unit.trimStart();
  });
  if (current) messages.push(trim ? current.trim() : current);
  return messages;
}

function splitOversizedMarkdown(token: string, limit: number): string[] {
  const raw = (value: string, size: number, preserveWhitespace = false) =>
    packTextUnits(
      value
        .match(/\\[\s\S]|[^\s\\]+|\s+|[\s\S]/gu)
        ?.flatMap((word) => (word.length <= size ? [word] : Array.from(word))) ?? [],
      size,
      !preserveWhitespace,
    );
  const fence = /^(`{3,})([^\n]*)\n([\s\S]*)\n\1$/.exec(token);
  if (fence) {
    const opening = `${fence[1]}${fence[2]}\n`;
    const closing = `\n${fence[1]}`;
    const size = limit - opening.length - closing.length;
    return size >= 3
      ? raw(fence[3]!, size, true).map((chunk) => `${opening}${chunk}${closing}`)
      : raw(fence[3]!, limit);
  }
  const prefix = /^(>+[ \t]*|#{1,6}[ \t]+|-#[ \t]+)([\s\S]*)$/.exec(token);
  if (prefix && limit - prefix[1]!.length >= 3)
    return splitDiscordText(prefix[2]!, limit - prefix[1]!.length).map(
      (chunk) => `${prefix[1]}${chunk}`,
    );
  const span = /^(\*\*|__|~~|`+|\*|_)([\s\S]*)\1$/.exec(token);
  if (span) {
    const marker = span[1]!;
    const size = limit - marker.length * 2;
    if (size >= 3) {
      const chunks = marker.startsWith("`")
        ? raw(span[2]!, size, true)
        : splitDiscordText(span[2]!, size);
      return chunks.map((chunk) => `${marker}${chunk}${marker}`);
    }
    return raw(span[2]!, limit);
  }
  // A single masked link larger than a message cannot stay intact; degrade only that link.
  const link = /^\[((?:\\.|[^\]\\])*)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
  return raw(link ? `${link[1]} (${link[2]})` : token, limit);
}

export function splitDiscordText(text: string, limit = 1900): string[] {
  if (limit < 3) throw new RangeError("The message limit must be at least 3.");
  const remaining = text.trim();
  if (remaining.length <= limit) return remaining ? [remaining] : [];
  // Keep links, inline formatting, code fences and quote/heading lines atomic.
  const tokens =
    remaining.match(
      /(?<fence>`{3,})[^\n]*\n[\s\S]*?\n\k<fence>|^(?:>+[ \t]*|#{1,6}[ \t]+|-#[ \t]+)[^\n]+$|\[((?:\\.|[^\]\\])*)\]\(https?:\/\/[^\s)]+\)|(?<code>`+)[^\n]*?\k<code>|\*\*(?:\\.|[^\\])*?\*\*|__(?:\\.|[^\\])*?__|~~(?:\\.|[^\\])*?~~|\*(?!\*)(?:\\.|[^*\\\n])+\*|_(?!_)(?:\\.|[^_\\\n])+_|\\[\s\S]|[^\\\s[\]*_~`]+|\s+|[\s\S]/gmu,
    ) ?? [];
  const messages: string[] = [];
  let pending: string[] = [];
  tokens.forEach((token) => {
    if (token.length <= limit) pending.push(token);
    else {
      messages.push(...packTextUnits(pending, limit), ...splitOversizedMarkdown(token, limit));
      pending = [];
    }
  });
  return [...messages, ...packTextUnits(pending, limit)].filter(Boolean);
}

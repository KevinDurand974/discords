import {
  ContainerBuilder,
  escapeMarkdown,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";
import { UserFacingError } from "@/core/errors.ts";

export function createPostMessage(titleInput: string, bodyInput: string) {
  const title = titleInput.trim();
  const body = bodyInput.trim();
  if (!title || title.length > 100 || /[\r\n]/.test(title)) {
    throw new UserFacingError("Enter a title of 1–100 characters on one line.");
  }
  if (!body || body.length > 4000) {
    throw new UserFacingError("Enter post content of 1–4000 characters.");
  }
  const parts = body.split("---");
  if (!parts.some((part) => part.trim())) {
    throw new UserFacingError("Enter post content, not only separators.");
  }
  // 20 text sections + 19 separators + the container reach Discord's 40-component limit.
  const sections = parts.length > 20 ? [...parts.slice(0, 19), parts.slice(19).join("---")] : parts;
  const texts = sections.map((section, index) =>
    index === 0 ? `# ${escapeMarkdown(title)}\n\n${section.trim()}`.trimEnd() : section.trim(),
  );
  if (texts.reduce((total, text) => total + text.length, 0) > 4000) {
    throw new UserFacingError(
      "The title and post are too long together. Shorten them to fit 4000 characters.",
    );
  }
  const container = new ContainerBuilder().setAccentColor(0x5865f2);
  texts.forEach((text, index) => {
    if (index > 0)
      container.addSeparatorComponents(
        new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large),
      );
    if (text) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  });
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: [container],
    allowedMentions: { parse: [] as const },
  };
}

import {
  ContainerBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from "discord.js";

export const DEFAULT_ARRIVAL_MESSAGE = `# 👋 Welcome to {server}!

Hey **{user}**, welcome!\x20\x20
We're glad to have you here.

Take a moment to explore the server and set things up the way you like.

---

📖 **Rules**\x20\x20
Check out the server rules before jumping in.

💬 **Community**\x20\x20
Join the conversation, meet other members, and have fun!

---

✨ You're our **{memberCount}th member**.\x20\x20
Enjoy your stay!`;

export function createWelcomeMessageContainer(message: string, arrival: boolean) {
  const sections = message.split(/^[ \t]*---[ \t]*\r?$/m);
  const components = sections.flatMap((section, index) => {
    const text = section.trim();
    return [
      ...(index > 0
        ? [new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Large)]
        : []),
      ...(text ? [new TextDisplayBuilder().setContent(text)] : []),
    ];
  });
  if (!components.some((component) => component instanceof TextDisplayBuilder)) {
    throw new Error("Welcome messages must contain text, not only separators.");
  }
  // Discord allows 40 components in total, including the container itself.
  if (components.length > 39) {
    throw new Error("Too many welcome message sections. Use fewer separator lines.");
  }
  const container = new ContainerBuilder().setAccentColor(arrival ? 0x57f287 : 0x95a5a6);
  for (const component of components) {
    if (component instanceof SeparatorBuilder) container.addSeparatorComponents(component);
    else container.addTextDisplayComponents(component);
  }
  return container;
}

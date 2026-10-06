import { randomBytes, randomInt } from "node:crypto";

export const PICK_INPUT_LIMIT = 1500;
export const PICK_SESSION_TTL = 15 * 60 * 1000;
const MAX_SESSIONS = 1000;

export function parsePickChoices(input: string): string[] {
  if (input.length > PICK_INPUT_LIMIT) throw new Error("Enter at most 1500 characters in total.");
  const choices = input
    .split(/\r\n?|\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (choices.length < 2 || choices.length > 50)
    throw new Error("Enter 2–50 options, one per line.");
  if (choices.some((choice) => choice.length > 100))
    throw new Error("Each option must be at most 100 characters.");
  return choices;
}

export type PickSession = {
  userId: string;
  choices: readonly string[];
  expiresAt: number;
  result?: number;
};

export function createPickSessionStore() {
  const sessions = new Map<string, PickSession>();
  const prune = () =>
    sessions.forEach((session, token) => {
      if (session.expiresAt <= Date.now()) sessions.delete(token);
    });
  return {
    create(userId: string, choices: readonly string[]) {
      prune();
      if (sessions.size >= MAX_SESSIONS)
        throw new Error("Too many active draws. Try again in a few minutes.");
      const token = randomBytes(16).toString("hex");
      const session: PickSession = {
        userId,
        choices: [...choices],
        expiresAt: Date.now() + PICK_SESSION_TTL,
      };
      sessions.set(token, session);
      return { token, session };
    },
    remove(token: string) {
      sessions.delete(token);
    },
    draw(token: string, userId: string) {
      prune();
      const session = sessions.get(token);
      if (!session) throw new Error("This draw has expired or the bot restarted. Run /pick again.");
      if (session.userId !== userId)
        throw new Error(
          "Only the person who created this draw can get its result. Run /pick to create your own.",
        );
      // Cache the draw before any Discord request so simultaneous clicks cannot reroll it.
      session.result ??= randomInt(0, session.choices.length);
      return session;
    },
  };
}

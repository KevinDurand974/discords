import type { PollData } from "discord.js";

export const MAX_POLL_ANSWERS = 10;
export const MAX_POLL_DURATION = 32 * 24;

export function createPollFromForm(
  question: string,
  answerLines: string,
  durationText: string,
  votingModes: readonly string[],
): PollData {
  const duration = durationText.trim();
  if (duration && !/^\d+$/.test(duration)) {
    throw new Error("The poll duration must be a whole number between 1 and 768 hours.");
  }
  if (votingModes.length !== 1 || !["single", "multiple"].includes(votingModes[0]!)) {
    throw new Error("Choose single-choice or multiple-choice voting.");
  }
  return createPollData(
    question,
    answerLines
      .split(/\r\n|\n|\r/)
      .map((answer) => answer.trim())
      .filter(Boolean),
    duration ? Number(duration) : 24,
    votingModes[0] === "multiple",
  );
}

export function createPollData(
  question: string,
  answers: readonly string[],
  duration = 24,
  allowMultiselect = false,
): PollData {
  const text = question.trim();
  if (!text || text.length > 300) {
    throw new Error("The poll question must contain between 1 and 300 characters.");
  }
  if (answers.length < 2 || answers.length > MAX_POLL_ANSWERS) {
    throw new Error("A poll must have between 2 and 10 answers.");
  }
  const choices = answers.map((answer) => answer.trim());
  if (choices.some((answer) => !answer || answer.length > 55)) {
    throw new Error("Each poll answer must contain between 1 and 55 characters.");
  }
  if (new Set(choices.map((answer) => answer.toLowerCase())).size !== choices.length) {
    throw new Error("Poll answers must be unique.");
  }
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_POLL_DURATION) {
    throw new Error("The poll duration must be a whole number between 1 and 768 hours.");
  }
  return {
    question: { text },
    answers: choices.map((answer) => ({ text: answer })),
    duration,
    allowMultiselect,
  };
}

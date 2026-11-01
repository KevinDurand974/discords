import type { Subscription } from "./videos-repository.ts";

export type ContentMode = Subscription["contentMode"];
export const contentChoices = [
  { name: "Videos + Shorts", value: "all" },
  { name: "Videos only", value: "videos" },
  { name: "Shorts only", value: "shorts" },
] satisfies { name: string; value: ContentMode }[];

export function contentLabel(mode: ContentMode): string {
  return contentChoices.find((choice) => choice.value === mode)!.name;
}
export function parseContentMode(value: string): ContentMode {
  const mode = contentChoices.find((choice) => choice.value === value)?.value;
  if (!mode) throw new Error("Invalid YouTube content mode.");
  return mode;
}
export function matchesContent(mode: ContentMode, isShort: boolean | null): boolean {
  return mode === "all" || (isShort !== null && isShort === (mode === "shorts"));
}

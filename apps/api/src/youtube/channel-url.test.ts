import { describe, expect, it } from "vitest";
import { parseChannelInput } from "./channel-url.ts";
import { CHANNEL_ID } from "./fixtures.ts";

describe("YouTube channel inputs", () => {
  it.each([
    "@heartfulharry2185", " https://www.youtube.com/@heartfulharry2185/ ",
    "https://youtube.com/@heartfulharry2185?si=tracking#about",
  ])("normalizes a handle: %s", (input) => {
    expect(parseChannelInput(input)).toEqual({ kind: "handle", handle: "@heartfulharry2185",
      canonicalUrl: "https://www.youtube.com/@heartfulharry2185" });
  });
  it("preserves international handles", () => {
    expect(parseChannelInput("https://www.youtube.com/@%E6%97%A5%E6%9C%AC%E8%AA%9E")).toMatchObject({ handle: "@日本語" });
  });
  it.each([CHANNEL_ID, `https://www.youtube.com/channel/${CHANNEL_ID}/`])("accepts direct IDs: %s", (input) => {
    expect(parseChannelInput(input)).toEqual({ kind: "id", channelId: CHANNEL_ID,
      canonicalUrl: `https://www.youtube.com/channel/${CHANNEL_ID}` });
  });
  it.each([
    "", "@", "@has space", "UCinvalid", "http://youtube.com/@creator", "https://youtube.com.evil.test/@creator",
    "https://evil.test/@creator", "https://user:password@youtube.com/@creator", "https://youtube.com:8080/@creator",
    "https://youtu.be/ukbwlyMbG2M", "https://youtube.com/watch?v=ukbwlyMbG2M", "https://youtube.com/shorts/ukbwlyMbG2M",
    "https://youtube.com/playlist?list=123", "https://youtube.com/c/creator", "https://youtube.com/user/creator",
    "https://youtube.com/@creator/videos", "https://youtube.com/@bad%2Fhandle", "https://youtube.com/@bad%",
    "https://youtube.com\\@creator", "https://youtube.com/@cre\nator",
  ])("rejects unsafe/non-channel input: %s", (input) => {
    expect(() => parseChannelInput(input)).toThrow("Use a YouTube @handle");
  });
});

import { describe, expect, it } from "vitest";
import { emojiTransferCredentials } from "./emoji-transfer-credentials.ts";

const env = {
  DISCORD_TOKEN: "prod-token-placeholder",
  DISCORD_CLIENT_ID: "123456789012345678",
  DISCORD_DEV_TOKEN: "dev-token-placeholder",
  DISCORD_DEV_CLIENT_ID: "223456789012345678",
};

describe("emoji transfer credential selection", () => {
  it("selects each token and application ID as a pair", () => {
    expect(emojiTransferCredentials(env, "prod")).toEqual({
      target: "prod",
      token: env.DISCORD_TOKEN,
      applicationId: env.DISCORD_CLIENT_ID,
    });
    expect(emojiTransferCredentials(env, "dev")).toEqual({
      target: "dev",
      token: env.DISCORD_DEV_TOKEN,
      applicationId: env.DISCORD_DEV_CLIENT_ID,
    });
  });
  it("allows PROD operations without DEV credentials", () => {
    expect(
      emojiTransferCredentials(
        { DISCORD_TOKEN: env.DISCORD_TOKEN, DISCORD_CLIENT_ID: env.DISCORD_CLIENT_ID },
        "prod",
      ).applicationId,
    ).toBe(env.DISCORD_CLIENT_ID);
  });
  it.each(["DISCORD_DEV_TOKEN", "DISCORD_DEV_CLIENT_ID"] as const)(
    "fails on missing %s instead of falling back to production",
    (key) => {
      expect(() => emojiTransferCredentials({ ...env, [key]: undefined }, "dev")).toThrow(key);
      expect(() => emojiTransferCredentials({ ...env, [key]: "  " }, "dev")).toThrow(key);
    },
  );
  it.each(["DISCORD_TOKEN", "DISCORD_CLIENT_ID"] as const)(
    "fails on missing %s instead of falling back to development",
    (key) => {
      expect(() => emojiTransferCredentials({ ...env, [key]: undefined }, "prod")).toThrow(key);
    },
  );
  it("rejects malformed IDs and unknown targets without revealing tokens", () => {
    expect(() =>
      emojiTransferCredentials({ ...env, DISCORD_DEV_CLIENT_ID: "invalid" }, "dev"),
    ).toThrow("DISCORD_DEV_CLIENT_ID");
    expect(() => emojiTransferCredentials(env, "other")).toThrow("--target must be prod or dev");
  });
});

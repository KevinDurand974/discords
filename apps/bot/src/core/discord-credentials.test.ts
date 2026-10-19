import { describe, expect, it } from "vitest";
import { resolveDiscordCredentials } from "./discord-credentials.ts";

const prod = { DISCORD_TOKEN: "prod-placeholder", DISCORD_CLIENT_ID: "123456789012345678" };
const dev = { DISCORD_DEV_TOKEN: "dev-placeholder", DISCORD_DEV_CLIENT_ID: "223456789012345678" };

describe("runtime Discord credentials", () => {
  it("uses PROD when neither DEV value is configured", () => {
    expect(resolveDiscordCredentials(prod)).toEqual({
      token: prod.DISCORD_TOKEN,
      applicationId: prod.DISCORD_CLIENT_ID,
      target: "prod",
    });
  });
  it("prefers DEV as a complete pair even when PROD is configured", () => {
    expect(resolveDiscordCredentials({ ...prod, ...dev })).toEqual({
      token: dev.DISCORD_DEV_TOKEN,
      applicationId: dev.DISCORD_DEV_CLIENT_ID,
      target: "dev",
    });
  });
  it("supports a DEV-only environment without PROD credentials", () => {
    expect(resolveDiscordCredentials(dev)).toMatchObject({
      token: dev.DISCORD_DEV_TOKEN,
      applicationId: dev.DISCORD_DEV_CLIENT_ID,
    });
  });
  it("treats empty DEV fields as unconfigured", () => {
    expect(
      resolveDiscordCredentials({ ...prod, DISCORD_DEV_TOKEN: " ", DISCORD_DEV_CLIENT_ID: "" })
        .target,
    ).toBe("prod");
  });
  it("trims surrounding whitespace without modifying the environment", () => {
    const env = {
      DISCORD_DEV_TOKEN: " dev-placeholder ",
      DISCORD_DEV_CLIENT_ID: ` ${dev.DISCORD_DEV_CLIENT_ID} `,
    };
    expect(resolveDiscordCredentials(env)).toMatchObject({
      token: "dev-placeholder",
      applicationId: dev.DISCORD_DEV_CLIENT_ID,
    });
    expect(env.DISCORD_DEV_TOKEN).toBe(" dev-placeholder ");
  });
  it.each([
    { ...prod, DISCORD_DEV_TOKEN: dev.DISCORD_DEV_TOKEN },
    { ...prod, DISCORD_DEV_TOKEN: dev.DISCORD_DEV_TOKEN, DISCORD_DEV_CLIENT_ID: " " },
  ])("does not mix a DEV token with a PROD ID", (env) => {
    expect(() => resolveDiscordCredentials(env)).toThrow("DISCORD_DEV_CLIENT_ID");
  });
  it.each([
    { ...prod, DISCORD_DEV_CLIENT_ID: dev.DISCORD_DEV_CLIENT_ID },
    { ...prod, DISCORD_DEV_CLIENT_ID: dev.DISCORD_DEV_CLIENT_ID, DISCORD_DEV_TOKEN: " " },
  ])("does not mix a DEV ID with a PROD token", (env) => {
    expect(() => resolveDiscordCredentials(env)).toThrow("DISCORD_DEV_TOKEN");
  });
  it("does not silently fall back when the DEV ID is invalid", () => {
    expect(() =>
      resolveDiscordCredentials({ ...prod, ...dev, DISCORD_DEV_CLIENT_ID: "invalid" }),
    ).toThrow("DISCORD_DEV_CLIENT_ID");
  });
  it.each([
    [{}, "DISCORD_TOKEN"],
    [{ DISCORD_CLIENT_ID: prod.DISCORD_CLIENT_ID }, "DISCORD_TOKEN"],
    [{ DISCORD_TOKEN: prod.DISCORD_TOKEN }, "DISCORD_CLIENT_ID"],
  ] as const)("rejects missing credentials instead of attempting login", (env, key) => {
    expect(() => resolveDiscordCredentials(env)).toThrow(key);
  });
  it("keeps explicit emoji-transfer targets independent of runtime DEV priority", () => {
    expect(resolveDiscordCredentials({ ...prod, ...dev }, "prod")).toMatchObject({
      token: prod.DISCORD_TOKEN,
      applicationId: prod.DISCORD_CLIENT_ID,
      target: "prod",
    });
    expect(resolveDiscordCredentials({ ...prod, ...dev }, "dev")).toMatchObject({
      token: dev.DISCORD_DEV_TOKEN,
      applicationId: dev.DISCORD_DEV_CLIENT_ID,
      target: "dev",
    });
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { composeEnvironment } from "./docker.mjs";

test("builds container credentials and URL without reusing the host localhost URL", () => {
  const env = composeEnvironment({
    DATABASE_URL: "postgresql://other:other@localhost:5432/discords",
    POSTGRES_USER: "discords",
    POSTGRES_DB: "discords",
    POSTGRES_PASSWORD: "p@ss:word/#",
    PORT: 3000,
  });
  const url = new URL(env.API_DATABASE_URL);
  assert.equal(url.hostname, "postgres");
  assert.equal(url.username, "discords");
  assert.equal(decodeURIComponent(url.password), "p@ss:word/#");
  assert.equal(url.pathname, "/discords");
  assert.equal(env.POSTGRES_PASSWORD, "p@ss:word/#");
  assert.equal(env.PORT, "3000");
});

test("forwards Discord credentials from the shared environment without requiring them for API-only commands", () => {
  const values = { POSTGRES_USER: "discords", POSTGRES_DB: "discords", POSTGRES_PASSWORD: "secret", PORT: 3000 };
  assert.equal(composeEnvironment(values).DISCORD_TOKEN, "");
  const env = composeEnvironment({ ...values, DISCORD_TOKEN: "bot-token", DISCORD_CLIENT_ID: "123", DISCORD_OWNER_CLIENT_ID: "456", DISCORD_GUILD_ID: "789" });
  assert.equal(env.DISCORD_TOKEN, "bot-token");
  assert.equal(env.DISCORD_CLIENT_ID, "123");
  assert.equal(env.DISCORD_OWNER_CLIENT_ID, "456");
  assert.equal(env.DISCORD_GUILD_ID, "789");
});

test("requires a configured password and valid port", () => {
  assert.throws(() => composeEnvironment({ POSTGRES_USER: "discords", POSTGRES_DB: "discords", PORT: 3000 }), /POSTGRES_PASSWORD/);
  assert.throws(() => composeEnvironment({ POSTGRES_USER: "discords", POSTGRES_DB: "discords", POSTGRES_PASSWORD: "secret", PORT: 0 }), /PORT/);
});

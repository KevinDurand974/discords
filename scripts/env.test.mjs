import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const cli = join(root, "node_modules/varlock/bin/cli.js");
const schemas = [".env.schema", "apps/api/.env.schema", "apps/bot/.env.schema", "apps/jobs/.env.schema", "packages/db/.env.schema"];

function fixture(values) {
  const path = mkdtempSync(join(tmpdir(), "discords-env-"));
  schemas.forEach((schema) => {
    mkdirSync(dirname(join(path, schema)), { recursive: true });
    copyFileSync(join(root, schema), join(path, schema));
  });
  writeFileSync(join(path, ".env"), Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n"));
  return path;
}

function check(path, cwd, expression, filter, expectedSuccess = true, overrides = {}) {
  const env = { ...process.env };
  ["__VARLOCK_ENV", "_VARLOCK_FILTER", "_VARLOCK_ENV", ...Object.keys(values), "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_OWNER_CLIENT_ID"].forEach((key) => delete env[key]);
  const result = spawnSync(process.execPath, [cli, "run", ...(filter ? ["--filter", filter] : []), "--inject", "vars", "--", process.execPath, "-e", expression], {
    cwd: join(path, cwd), env: { ...env, ...overrides }, encoding: "utf8", timeout: 20_000,
  });
  if (expectedSuccess) assert.equal(result.status, 0, result.stdout + result.stderr);
  else assert.notEqual(result.status, 0, "Expected Varlock validation to reject this configuration");
}

const values = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  POSTGRES_PASSWORD: "fixture-password",
  NEWS_INTERNAL_TOKEN: "fixture-news-token",
  JOBS_INTERNAL_TOKEN: "fixture-jobs-token",
  YOUTUBE_API_KEY: "fixture-youtube-key",
  NEWS_API_URL: "http://localhost:3100",
};

const assertEnv = (checks) => `const assert = require('node:assert/strict'); ${checks}`;

test("API, jobs and database load root values without Discord credentials", () => {
  const path = fixture(values);
  try {
    check(path, "apps/api", assertEnv("assert.equal(process.env.YOUTUBE_API_KEY, 'fixture-youtube-key'); assert.equal(process.env.DISCORD_TOKEN, undefined);"));
    check(path, "apps/jobs", assertEnv("assert.equal(process.env.NEWS_API_URL, 'http://localhost:3100'); assert.equal(process.env.JOBS_INTERNAL_TOKEN, 'fixture-jobs-token'); assert.equal(process.env.YOUTUBE_API_KEY, undefined); assert.equal(process.env.DATABASE_URL, undefined);"));
    check(path, "packages/db", assertEnv("assert.equal(process.env.DATABASE_URL, 'postgresql://test:test@localhost:5432/test'); assert.equal(process.env.YOUTUBE_API_KEY, undefined);"));
    check(path, ".", assertEnv("assert.equal(process.env.POSTGRES_PASSWORD, 'fixture-password'); assert.equal(process.env.DISCORD_TOKEN, undefined);"), "#docker");
    check(path, "apps/bot", "process.exit(0)", undefined, false);
    check(path, "packages/db", assertEnv("assert.equal(process.env.DATABASE_URL, 'postgresql://override:override@localhost:5432/override');"), undefined, true, { DATABASE_URL: "postgresql://override:override@localhost:5432/override" });
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

test("bot and full Docker profile load shared root values but bot excludes the API key", () => {
  const path = fixture({ ...values, DISCORD_TOKEN: "fixture-discord-token", DISCORD_CLIENT_ID: "123", DISCORD_OWNER_CLIENT_ID: "456" });
  try {
    check(path, "apps/bot", assertEnv("assert.equal(process.env.DISCORD_TOKEN, 'fixture-discord-token'); assert.equal(process.env.NEWS_INTERNAL_TOKEN, 'fixture-news-token'); assert.equal(process.env.YOUTUBE_API_KEY, undefined);"));
    check(path, ".", assertEnv("assert.equal(process.env.DISCORD_TOKEN, 'fixture-discord-token'); assert.equal(process.env.POSTGRES_PASSWORD, 'fixture-password');"), "#docker,#bot,#jobs");
  } finally {
    rmSync(path, { recursive: true, force: true });
  }
});

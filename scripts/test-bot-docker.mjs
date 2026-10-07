import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.BOT_TEST_IMAGE || "discords-bot:test";
const prefix = `discords-bot-test-${randomBytes(6).toString("hex")}`;
const network = `${prefix}-network`;
const postgres = `${prefix}-postgres`;
const bot = `${prefix}-bot`;
const volume = `${prefix}-data`;
const directory = mkdtempSync(join(tmpdir(), "discords-bot-docker-"));
const fixture = join(directory, "smoke.ts");
const password = randomBytes(24).toString("hex");
const databaseUrl = `postgresql://discords:${password}@${postgres}:5432/discords`;
const docker = (args, inherit = false) =>
  (
    execFileSync("docker", args, {
      encoding: "utf8",
      stdio: inherit ? "inherit" : "pipe",
      timeout: 600_000,
    }) ?? ""
  ).trim();
const ignore = (args) => {
  try {
    docker(args);
  } catch {}
};
async function waitFor(check, description) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch {}
    await delay(1000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

writeFileSync(
  fixture,
  `
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { commands } from "@/core/command-registry.ts";
import { createDiscordClient } from "@/core/client.ts";
import { createBotHealthServer } from "@/core/health.ts";
assert.notEqual(process.getuid(), 0);
assert.equal(existsSync("/app/apps/api"), false);
assert.equal(existsSync("/app/apps/jobs"), false);
assert.equal(existsSync("/app/.env"), false);
assert.ok(commands.length > 0);
const client = createDiscordClient();
assert.equal(client.isReady(), false);
await client.destroy();
writeFileSync("/app/apps/bot/data/smoke-test", "writable");
unlinkSync("/app/apps/bot/data/smoke-test");
let ready = false;
const server = createBotHealthServer({ isReady: () => ready }, process.env.DATABASE_URL);
await new Promise<void>((resolve) => server.listen(Number(process.env.BOT_HEALTH_PORT), process.env.BOT_HEALTH_HOST, resolve));
const response = await fetch("http://127.0.0.1:" + process.env.BOT_HEALTH_PORT + "/health/ready");
assert.equal(response.status, 503);
ready = true;
console.log("PASS command registry, aliases, Discord client, writable volume and disconnected readiness");
`,
);

try {
  docker(["build", "--file", "apps/bot/Dockerfile", "--target", "bot", "--tag", image, "."], true);
  assert.deepEqual(
    JSON.parse(docker(["image", "inspect", "--format", "{{json .Config.Cmd}}", image])),
    ["nub", "--cwd", "apps/bot", "run", "start"],
  );
  docker(["network", "create", network]);
  docker(["volume", "create", volume]);
  docker([
    "run",
    "--detach",
    "--name",
    postgres,
    "--network",
    network,
    "--env",
    "POSTGRES_USER=discords",
    "--env",
    "POSTGRES_DB=discords",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "postgres:17-alpine",
  ]);
  await waitFor(() => {
    docker([
      "exec",
      postgres,
      "pg_isready",
      "--host=127.0.0.1",
      "--username=discords",
      "--dbname=discords",
    ]);
    return true;
  }, "PostgreSQL");
  docker([
    "run",
    "--detach",
    "--name",
    bot,
    "--network",
    network,
    "--publish",
    "127.0.0.1::3001",
    "--mount",
    `type=bind,src=${fixture},dst=/app/apps/bot/docker-smoke.ts,readonly`,
    "--mount",
    `type=volume,src=${volume},dst=/app/apps/bot/data`,
    "--env",
    `DATABASE_URL=${databaseUrl}`,
    "--env",
    "DISCORD_TOKEN=smoke-test-not-a-real-token",
    "--env",
    "DISCORD_CLIENT_ID=123456789012345678",
    "--env",
    "DISCORD_OWNER_CLIENT_ID=123456789012345679",
    image,
    "nub",
    "--cwd",
    "apps/bot",
    "./docker-smoke.ts",
  ]);
  const port = docker(["port", bot, "3001/tcp"]).split(":").at(-1);
  await waitFor(
    async () =>
      (await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(5000) }))
        .ok,
    "bot smoke readiness",
  );
  assert.equal(
    (await fetch(`http://127.0.0.1:${port}/health/live`, { signal: AbortSignal.timeout(5000) }))
      .status,
    200,
  );
  await waitFor(
    () => docker(["inspect", "--format", "{{.State.Health.Status}}", bot]) === "healthy",
    "Docker healthcheck",
  );
  docker(["logs", bot], true);
  console.log(
    "PASS automatic migrations, bot health routes and Docker healthcheck (Discord readiness simulated)",
  );
} catch (error) {
  try {
    docker(["logs", bot], true);
  } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  ignore(["rm", "--force", bot, postgres]);
  ignore(["volume", "rm", volume]);
  ignore(["network", "rm", network]);
  rmSync(directory, { recursive: true, force: true });
}

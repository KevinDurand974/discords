import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.API_TEST_IMAGE || "discords-api:test";
const prefix = `discords-api-test-${randomBytes(6).toString("hex")}`;
const network = `${prefix}-network`;
const postgres = `${prefix}-postgres`;
const api = `${prefix}-api`;
const failedApi = `${prefix}-migration-failure`;
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

try {
  docker(["build", "--file", "apps/api/Dockerfile", "--target", "api", "--tag", image, "."], true);
  docker(["network", "create", network]);
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
    api,
    "--network",
    network,
    "--publish",
    "127.0.0.1::3000",
    "--env",
    `DATABASE_URL=${databaseUrl}`,
    "--env",
    "POSTGRES_USER=discords",
    "--env",
    "POSTGRES_DB=discords",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    image,
  ]);
  const port = docker(["port", api, "3000/tcp"]).split(":").at(-1);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => (await fetch(`${baseUrl}/health/ready`, { signal: AbortSignal.timeout(5000) })).ok,
    "API readiness",
  );
  const paths = ["/health/live", "/health/ready", "/v1/news/categories"];
  await Promise.all(
    paths.map(async (path) => {
      const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
      await response.json();
      console.log(`PASS ${path}`);
    }),
  );
  docker([
    "exec",
    api,
    "node",
    "-e",
    "const fs = require('node:fs'); if (process.getuid() === 0 || fs.existsSync('/app/apps/bot') || fs.existsSync('/app/.env')) process.exit(1)",
  ]);
  await waitFor(
    () => docker(["inspect", "--format", "{{.State.Health.Status}}", api]) === "healthy",
    "Docker healthcheck",
  );
  console.log("PASS non-root API-only image, automatic migrations and Docker healthcheck");
  docker(["restart", api]);
  const restartPort = docker(["port", api, "3000/tcp"]).split(":").at(-1);
  await waitFor(
    async () =>
      (
        await fetch(`http://127.0.0.1:${restartPort}/health/ready`, {
          signal: AbortSignal.timeout(5000),
        })
      ).ok,
    "API restart after repeat migrations",
  );
  console.log("PASS restarting against an already migrated database");

  docker([
    "run",
    "--detach",
    "--name",
    failedApi,
    "--network",
    network,
    "--env",
    `DATABASE_URL=postgresql://discords:wrong-password@${postgres}:5432/discords`,
    "--env",
    "POSTGRES_USER=discords",
    "--env",
    "POSTGRES_DB=discords",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    image,
  ]);
  await waitFor(
    () => docker(["inspect", "--format", "{{.State.Status}}", failedApi]) === "exited",
    "failed migration exit",
  );
  if (docker(["inspect", "--format", "{{.State.ExitCode}}", failedApi]) === "0") {
    throw new Error("A failed migration must produce a nonzero exit code");
  }
  if (docker(["logs", failedApi]).includes("API listening")) {
    throw new Error("The API must not start when migration fails");
  }
  console.log("PASS migration failure aborts API startup");
} catch (error) {
  try {
    docker(["logs", api], true);
  } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  ignore(["rm", "--force", api, failedApi, postgres]);
  ignore(["network", "rm", network]);
}

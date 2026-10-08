import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const image = process.env.JOBS_TEST_IMAGE || "discords-jobs:test";
const prefix = `discords-jobs-test-${randomBytes(6).toString("hex")}`;
const network = `${prefix}-network`;
const redis = `${prefix}-redis`;
const stub = `${prefix}-stub`;
const jobs = `${prefix}-jobs`;
const token = randomBytes(24).toString("hex");
const directory = mkdtempSync(join(tmpdir(), "discords-jobs-docker-"));
const fixture = join(directory, "stub.mjs");
const expectedPaths = [
  "news-ingestion",
  "news-publication",
  "youtube-ingestion",
  "youtube-publication",
  "ticket-closures",
];
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
import { createServer } from "node:http";
const paths = new Set();
createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/requests") return response.end(JSON.stringify([...paths]));
  if (request.method !== "POST" || request.headers.authorization !== "Bearer " + process.env.JOBS_INTERNAL_TOKEN) {
    response.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  paths.add(request.url);
  response.end(JSON.stringify({ complete: true }));
}).listen(3000, "0.0.0.0");
`,
);

try {
  docker(
    ["build", "--file", "apps/jobs/Dockerfile", "--target", "jobs", "--tag", image, "."],
    true,
  );
  docker(["network", "create", network]);
  docker(["run", "--detach", "--name", redis, "--network", network, "redis:7-alpine"]);
  await waitFor(() => docker(["exec", redis, "redis-cli", "ping"]) === "PONG", "Redis");
  docker([
    "run",
    "--detach",
    "--name",
    stub,
    "--network",
    network,
    "--entrypoint",
    "node",
    "--mount",
    `type=bind,src=${fixture},dst=/app/stub.mjs,readonly`,
    "--env",
    `JOBS_INTERNAL_TOKEN=${token}`,
    image,
    "/app/stub.mjs",
  ]);
  await waitFor(() => {
    docker([
      "exec",
      stub,
      "node",
      "-e",
      "fetch('http://127.0.0.1:3000/requests').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))",
    ]);
    return true;
  }, "mock API and bot");
  docker([
    "run",
    "--detach",
    "--name",
    jobs,
    "--network",
    network,
    "--publish",
    "127.0.0.1::3002",
    "--env",
    `REDIS_URL=redis://${redis}:6379`,
    "--env",
    `NEWS_API_URL=http://${stub}:3000`,
    "--env",
    `BOT_URL=http://${stub}:3000`,
    "--env",
    `JOBS_INTERNAL_TOKEN=${token}`,
    image,
  ]);
  const port = docker(["port", jobs, "3002/tcp"]).split(":").at(-1);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitFor(
    async () => (await fetch(`${baseUrl}/health/live`, { signal: AbortSignal.timeout(5000) })).ok,
    "jobs health",
  );
  const dashboard = await fetch(`${baseUrl}/admin/queues`, { signal: AbortSignal.timeout(5000) });
  assert.equal(dashboard.status, 200);
  const html = await dashboard.text();
  const assetPath = html.match(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/)?.[1];
  assert.ok(assetPath, "Bull Board must include a static asset");
  const documentBase = html.match(/<base\s+href="([^"]+)"/)?.[1];
  assert.ok(documentBase, "Bull Board must declare its asset base path");
  const asset = await fetch(new URL(assetPath, new URL(documentBase, dashboard.url)), {
    signal: AbortSignal.timeout(5000),
  });
  const assetBody = await asset.text();
  assert.equal(asset.status, 200, `${asset.url}: ${assetBody.slice(0, 1000)}`);
  assert.ok(assetBody.length > 0);
  console.log("PASS jobs health, Bull Board dashboard and static assets");
  await waitFor(() => {
    const paths = JSON.parse(
      docker([
        "exec",
        stub,
        "node",
        "-e",
        "fetch('http://127.0.0.1:3000/requests').then(r => r.json()).then(v => console.log(JSON.stringify(v)))",
      ]),
    );
    return expectedPaths.every((path) => paths.includes(`/internal/jobs/${path}`));
  }, "authenticated startup jobs");
  assert.equal(
    docker(["exec", redis, "redis-cli", "ZCARD", "bull:discords-maintenance:repeat"]),
    "4",
  );
  assert.equal(
    docker(["exec", redis, "redis-cli", "ZCARD", "bull:discords-ticket-closures:repeat"]),
    "1",
  );
  console.log("PASS authenticated startup jobs and five recurring Redis schedules");
  docker([
    "exec",
    jobs,
    "node",
    "-e",
    "const fs = require('node:fs'); if (process.getuid() === 0 || ['/app/apps/api', '/app/apps/bot', '/app/packages/db', '/app/.env'].some(p => fs.existsSync(p))) process.exit(1)",
  ]);
  await waitFor(
    () => docker(["inspect", "--format", "{{.State.Health.Status}}", jobs]) === "healthy",
    "Docker healthcheck",
  );
  docker(["stop", "--time", "20", jobs]);
  assert.equal(docker(["inspect", "--format", "{{.State.ExitCode}}", jobs]), "0");
  console.log("PASS non-root jobs-only image, Docker healthcheck and graceful shutdown");
} catch (error) {
  try {
    docker(["logs", jobs], true);
  } catch {}
  console.error(error);
  process.exitCode = 1;
} finally {
  ignore(["rm", "--force", jobs, stub, redis]);
  ignore(["network", "rm", network]);
  rmSync(directory, { recursive: true, force: true });
}

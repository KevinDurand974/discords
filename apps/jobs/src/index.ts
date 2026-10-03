import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ElysiaAdapter } from "@bull-board/elysia";
import { node } from "@elysiajs/node";
import { Queue, Worker } from "bullmq";
import { Elysia } from "elysia";

const queueName = "discords-maintenance";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const apiUrl = requiredUrl("NEWS_API_URL", process.env.NEWS_API_URL ?? "http://127.0.0.1:3000");
const botUrl = requiredUrl("BOT_URL", process.env.BOT_URL ?? "http://127.0.0.1:3001");
const jobsToken = required("JOBS_INTERNAL_TOKEN", process.env.JOBS_INTERNAL_TOKEN);
const dashboardPort = port("JOBS_DASHBOARD_PORT", process.env.JOBS_DASHBOARD_PORT ?? "3002");
const dashboardHost = process.env.JOBS_DASHBOARD_HOST ?? "127.0.0.1";

const redis = new URL(redisUrl);
if (redis.protocol !== "redis:" && redis.protocol !== "rediss:")
  throw new Error("REDIS_URL must use redis:// or rediss://");
const connection = {
  host: redis.hostname,
  port: redis.port ? Number(redis.port) : 6379,
  ...(redis.username ? { username: decodeURIComponent(redis.username) } : {}),
  ...(redis.password ? { password: decodeURIComponent(redis.password) } : {}),
  ...(redis.protocol === "rediss:" ? { tls: {} } : {}),
};
const queue = new Queue(queueName, { connection });

const worker = new Worker(
  queueName,
  async (job) => {
    const target =
      job.name === "news-ingestion"
        ? `${apiUrl}/internal/jobs/news-ingestion`
        : job.name === "news-publication"
          ? `${botUrl}/internal/jobs/news-publication`
          : undefined;
    if (!target) throw new Error(`Unknown job: ${job.name}`);
    const response = await fetch(target, {
      method: "POST",
      headers: { Authorization: `Bearer ${jobsToken}` },
      signal: AbortSignal.timeout(15 * 60 * 1000),
    });
    if (!response.ok) throw new Error(`${job.name} returned HTTP ${response.status}`);
  },
  { connection, concurrency: 1 },
);

worker.on("completed", (job) => console.info("Job completed", { id: job.id, name: job.name }));
worker.on("failed", (job, error) => console.error("Job failed", { id: job?.id, name: job?.name, error }));

await Promise.all([
  queue.upsertJobScheduler("news-ingestion-every-30-minutes", { pattern: "*/30 * * * *" }, {
    name: "news-ingestion",
    opts: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 100, removeOnFail: 100 },
  }),
  queue.upsertJobScheduler("news-publication-every-30-minutes", { pattern: "*/30 * * * *" }, {
    name: "news-publication",
    opts: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 100, removeOnFail: 100 },
  }),
]);
await Promise.all([
  queue.add("news-ingestion", {}, { jobId: "startup-news-ingestion", removeOnComplete: true }),
  queue.add("news-publication", {}, { jobId: "startup-news-publication", removeOnComplete: true }),
]);

const serverAdapter = new ElysiaAdapter({ prefix: "/admin/queues", basePath: "/admin/queues" });
createBullBoard({
  queues: [new BullMQAdapter(queue)],
  serverAdapter,
  options: { uiBasePath: "node_modules/@bull-board/ui" },
});
const dashboard = new Elysia({ adapter: node() })
  .get("/health/live", () => ({ status: "ok" }))
  .use(await serverAdapter.registerPlugin())
  .listen({ port: dashboardPort, hostname: dashboardHost });
console.info(`Jobs dashboard listening on http://${dashboardHost}:${dashboardPort}/admin/queues`);

async function shutdown() {
  dashboard.stop();
  await Promise.all([worker.close(), queue.close()]);
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

function required(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function requiredUrl(name: string, value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error(`${name} must use http:// or https://`);
  return url.toString().replace(/\/$/, "");
}

function port(name: string, value: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    throw new Error(`${name} must be between 1 and 65535`);
  return parsed;
}

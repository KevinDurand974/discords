import { createServer } from "node:http";
import { createDatabase } from "@discords/db";

export type BotJobHandlers = {
  token?: string | undefined;
  synchronizeNews?: (() => Promise<void>) | undefined;
};

export function createBotHealthServer(
  client: { isReady(): boolean },
  databaseUrl: string | undefined,
  jobs: BotJobHandlers = {},
) {
  const database = databaseUrl ? createDatabase(databaseUrl, { max: 2 }) : null;
  const server = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/health/live") {
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.method === "POST" && request.url === "/internal/jobs/news-publication") {
      if (!jobs.token || request.headers.authorization !== `Bearer ${jobs.token}`) {
        response.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      if (!jobs.synchronizeNews) {
        response.writeHead(503).end(JSON.stringify({ error: "Job handler unavailable" }));
        return;
      }
      try {
        await jobs.synchronizeNews();
        response.writeHead(204).end();
      } catch (error) {
        console.error("News publication job failed", error);
        response.writeHead(500).end(JSON.stringify({ error: "News publication failed" }));
      }
      return;
    }
    if (request.url !== "/health/ready") {
      response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
      return;
    }
    if (!client.isReady()) {
      response.writeHead(503).end(JSON.stringify({ status: "discord-unavailable" }));
      return;
    }
    try {
      const publications = database
        ? (
            await database.pool.query<{ guild_id: string; last_published_at: Date | null }>(
              "SELECT s.guild_id, MAX(a.published_at) AS last_published_at FROM netmarble_news_settings s LEFT JOIN netmarble_articles a ON a.guild_id = s.guild_id AND a.sync_state = 'published' WHERE s.enabled = true GROUP BY s.guild_id ORDER BY s.guild_id",
            )
          ).rows.map((row) => ({
            guildId: row.guild_id,
            lastPublishedAt: row.last_published_at?.toISOString() ?? null,
          }))
        : [];
      response.end(JSON.stringify({ status: "ok", publications }));
    } catch (error) {
      console.error("Bot health database check failed", error);
      response.writeHead(503).end(JSON.stringify({ status: "database-unavailable" }));
    }
  });
  server.on("close", () => {
    void database?.pool.end();
  });
  return server;
}

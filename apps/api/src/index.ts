import { createDatabase } from "@discords/db";
import { ENV } from "./config.ts";
import { createIngestion } from "./news/ingestion.ts";
import { createNewsReader } from "./news/repository.ts";
import { createNewsApp } from "./routes/news.ts";
import { createYoutubeApp } from "./routes/youtube.ts";
import { createYoutubeClient } from "./youtube/youtube-client.ts";
import { createYoutubeIngestion } from "./youtube/ingestion.ts";
import { createYoutubeReader, createYoutubeStore } from "./youtube/repository.ts";

const databaseOptions = { connectionTimeoutMillis: 5000 };
const database = createDatabase(ENV.DATABASE_URL, databaseOptions);
const { db } = database;
const ingestion = createIngestion(db);
const publicDatabase = createDatabase(ENV.DATABASE_URL, { ...databaseOptions, max: 5 });
const publicDb = publicDatabase.db;
const publicReader = createNewsReader(publicDb);
const internalToken = process.env.NEWS_INTERNAL_TOKEN;
const internalDatabase = internalToken
  ? createDatabase(ENV.DATABASE_URL, { ...databaseOptions, max: 3 })
  : undefined;
const internalDb = internalDatabase?.db;
const internalReader = internalDb ? createNewsReader(internalDb) : undefined;
const youtube = createYoutubeIngestion(
  createYoutubeStore(db),
  createYoutubeClient({ apiKey: ENV.YOUTUBE_API_KEY }),
  createYoutubeReader(db),
);
const port = ENV.PORT;
if (port === 0) throw new Error("PORT must be between 1 and 65535");

async function synchronize() {
  const result = await ingestion.syncAll();
  result.results.forEach((category) => {
    if ("error" in category) console.error("Netmarble ingestion failed", category);
    else
      console.info("Netmarble ingestion succeeded", { ...category, at: new Date().toISOString() });
  });
}

const app = createNewsApp(publicReader, {
  internalToken,
  internalReader,
  jobToken: process.env.JOBS_INTERNAL_TOKEN,
  synchronize,
  allowedOrigins: (process.env.NEWS_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
}).use(
  createYoutubeApp(createYoutubeReader(publicDb), youtube, {
    internalToken,
    internalReader: internalDb ? createYoutubeReader(internalDb) : undefined,
    jobToken: process.env.JOBS_INTERNAL_TOKEN,
    allowedOrigins: (process.env.NEWS_CORS_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  }),
);

const pools = [
  database.pool,
  publicDatabase.pool,
  ...(internalDatabase ? [internalDatabase.pool] : []),
];
const connectionQuery = { text: "SELECT 1", query_timeout: 5000 };
try {
  await Promise.all(pools.map((pool) => pool.query(connectionQuery)));
} catch {
  await Promise.allSettled(pools.map((pool) => pool.end()));
  throw new Error("Database connection check failed; API startup aborted.");
}
console.info("Database connections verified");
app.listen(port);
console.info(`News and YouTube API listening on ${port}`);

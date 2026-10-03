import { createDatabase } from "@discords/db";
import { ENV } from "./config.ts";
import { createIngestion } from "./news/ingestion.ts";
import { createNewsReader } from "./news/repository.ts";
import { createNewsApp } from "./routes/news.ts";
import { createYoutubeApp } from "./routes/youtube.ts";
import { createYoutubeClient } from "./youtube/youtube-client.ts";
import { createYoutubeIngestion } from "./youtube/ingestion.ts";
import { createYoutubeReader, createYoutubeStore } from "./youtube/repository.ts";

const { db } = createDatabase(ENV.DATABASE_URL);
const ingestion = createIngestion(db);
const publicDb = createDatabase(ENV.DATABASE_URL, { max: 5 }).db;
const publicReader = createNewsReader(publicDb);
const internalToken = process.env.NEWS_INTERNAL_TOKEN;
const internalDb = internalToken ? createDatabase(ENV.DATABASE_URL, { max: 3 }).db : undefined;
const internalReader = internalDb ? createNewsReader(internalDb) : undefined;
const youtube = createYoutubeIngestion(createYoutubeStore(db),
  createYoutubeClient({ apiKey: ENV.YOUTUBE_API_KEY }), createYoutubeReader(db));
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

createNewsApp(publicReader, {
  internalToken,
  internalReader,
  jobToken: process.env.JOBS_INTERNAL_TOKEN,
  synchronize,
  allowedOrigins: (process.env.NEWS_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
}).use(createYoutubeApp(createYoutubeReader(publicDb), youtube, {
  internalToken,
  internalReader: internalDb ? createYoutubeReader(internalDb) : undefined,
  jobToken: process.env.JOBS_INTERNAL_TOKEN,
  allowedOrigins: (process.env.NEWS_CORS_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean),
})).listen(port);
console.info(`News and YouTube API listening on ${port}`);

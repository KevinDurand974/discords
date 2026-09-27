import { Cron } from "croner";
import { createDatabase } from "@discords/db";
import { ENV } from "./config.ts";
import { createIngestion } from "./news/ingestion.ts";
import { createNewsReader } from "./news/repository.ts";
import { createNewsApp } from "./routes/news.ts";

const { db } = createDatabase(ENV.DATABASE_URL);
const ingestion = createIngestion(db);
const port = ENV.PORT;
if (port === 0) throw new Error("PORT must be between 1 and 65535");

async function synchronize() {
  const result = await ingestion.syncAll();
  result.results.forEach((category) => {
    if ("error" in category) console.error("Netmarble ingestion failed", category);
  });
  if (!result.skipped) console.info("Netmarble ingestion completed", result);
}

createNewsApp(createNewsReader(db)).listen(port);
new Cron("*/30 * * * *", { protect: true }, synchronize);
void synchronize().catch((error: unknown) => console.error("Netmarble ingestion failed", error));
console.info(`News API listening on ${port}`);

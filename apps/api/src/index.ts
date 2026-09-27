import { Cron } from "croner";
import { createDatabase } from "@discords/db";
import { createIngestion } from "./news/ingestion.ts";
import { createNewsReader } from "./news/repository.ts";
import { createNewsApp } from "./routes/news.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const { db } = createDatabase(databaseUrl);
const ingestion = createIngestion(db);
const port = Number(process.env.PORT ?? 3000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");

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

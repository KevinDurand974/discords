import { readFile } from "node:fs/promises";
import { createDatabase } from "@discords/db";
import { ENV } from "@/core/config.ts";
import { importLogChannels } from "@/core/import-log-channels.ts";

const path = process.argv[2] ?? new URL("../../data/log-channels.json", import.meta.url);
const data: unknown = JSON.parse(await readFile(path, "utf8"));
const database = createDatabase(ENV.DATABASE_URL);
try {
  const count = await importLogChannels(database, data);
  console.info(
    `Imported ${count} log channel settings. Existing database settings were preserved.`,
  );
} finally {
  await database.pool.end();
}

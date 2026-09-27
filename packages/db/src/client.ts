import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(databaseUrl: string) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl });
  return { db: drizzle({ client: pool }), pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];

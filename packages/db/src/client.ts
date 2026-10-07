import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

export function createDatabase(
  databaseUrl: string,
  options: { max?: number; connectionTimeoutMillis?: number } = {},
) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const pool = new Pool({ connectionString: databaseUrl, ...options });
  return { db: drizzle({ client: pool }), pool };
}

export type Database = ReturnType<typeof createDatabase>["db"];

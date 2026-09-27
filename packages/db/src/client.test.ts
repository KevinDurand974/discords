import { afterAll, describe, expect, it } from "vitest";
import { asc } from "drizzle-orm";
import { createDatabase } from "./client.ts";
import { newsCategories } from "./schema.ts";

const connection = process.env.DATABASE_URL;
const database = connection ? createDatabase(connection) : undefined;

if (database) afterAll(() => database.pool.end());

describe.skipIf(!database)("migrated PostgreSQL database", () => {
  it("reads all five seeded categories", async () => {
    const categories = await database!.db.select().from(newsCategories).orderBy(asc(newsCategories.menuSeq));
    expect(categories.map((category) => category.menuSeq)).toEqual([1, 13, 14, 32, 46]);
  });
});

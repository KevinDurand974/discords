import { afterEach, expect, it, vi } from "vitest";
import { createNewsSource } from "./news-api.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("reads every public API page and retrieves the matching article detail", async () => {
  const fetcher = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("categories"))
      return Response.json(
        [1, 13, 14, 32, 46].map((menuSeq) => ({ menuSeq, lastSyncedAt: "2026-01-01T00:00:00Z" })),
      );
    if (url.pathname.endsWith("/articles"))
      return Response.json(
        url.searchParams.has("cursor")
          ? { items: [{ id: 2 }], nextCursor: null }
          : { items: [{ id: 1 }], nextCursor: "more" },
      );
    return Response.json({ id: 2, menuSeq: 32 });
  });
  globalThis.fetch = fetcher as typeof fetch;
  const source = createNewsSource("http://localhost:3000");
  expect((await source.list()).map(({ id }) => id)).toEqual([1, 2]);
  expect(await source.detail(2, 32)).toMatchObject({ id: 2, menuSeq: 32 });
  expect(fetcher.mock.calls.at(-1)?.[0].toString()).toContain("/v1/news/articles/2?menuSeq=32");
});

it("does not initialize before all five categories have synced", async () => {
  globalThis.fetch = vi.fn(async () =>
    Response.json([{ menuSeq: 32, lastSyncedAt: null }]),
  ) as typeof fetch;
  await expect(createNewsSource("http://localhost:3000").list()).rejects.toThrow(
    "first source ingestion",
  );
});

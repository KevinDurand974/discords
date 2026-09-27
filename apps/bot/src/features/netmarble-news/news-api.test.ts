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
        url.searchParams.get("menuSeq") !== "32"
          ? { items: [], nextCursor: null }
          : url.searchParams.has("cursor")
            ? { items: [{ id: 2, createdAt: "2026-01-01T00:00:00Z" }], nextCursor: null }
            : { items: [{ id: 1, createdAt: "2026-01-02T00:00:00Z" }], nextCursor: "more" },
      );
    return Response.json({ id: 2, menuSeq: 32 });
  });
  globalThis.fetch = fetcher as typeof fetch;
  const source = createNewsSource("http://localhost:3000");
  expect((await source.list()).articles.map(({ id }) => id)).toEqual([1, 2]);
  expect(await source.detail(2, 32)).toMatchObject({ id: 2, menuSeq: 32 });
  expect(fetcher.mock.calls.at(-1)?.[0].toString()).toContain("/v1/news/articles/2?menuSeq=32");
});

it("keeps healthy categories when one category's article listing fails", async () => {
  globalThis.fetch = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("categories"))
      return Response.json(
        [1, 13, 14, 32, 46].map((menuSeq) => ({ menuSeq, lastSyncedAt: "2026-01-01T00:00:00Z" })),
      );
    if (url.searchParams.get("menuSeq") === "13") return new Response("Missing", { status: 404 });
    return Response.json({
      items: [{ id: Number(url.searchParams.get("menuSeq")), createdAt: "2026-01-01T00:00:00Z" }],
      nextCursor: null,
    });
  }) as typeof fetch;
  const result = await createNewsSource("http://localhost:3000").list();
  expect(result.articles.map(({ id }) => id)).toEqual([46, 32, 14, 1]);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]).toContain("Category 13");
});

it("retries transient API failures but not permanent failures", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response("Busy", { status: 503 }))
    .mockResolvedValueOnce(Response.json({ id: 42, menuSeq: 32 }))
    .mockResolvedValueOnce(new Response("Missing", { status: 404 }));
  globalThis.fetch = fetcher as typeof fetch;
  const source = createNewsSource("http://localhost:3000");
  expect(await source.detail(42, 32)).toMatchObject({ id: 42 });
  await expect(source.detail(99, 32)).rejects.toThrow("News API returned 404");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("does not initialize before all five categories have synced", async () => {
  globalThis.fetch = vi.fn(async () =>
    Response.json([{ menuSeq: 32, lastSyncedAt: null }]),
  ) as typeof fetch;
  await expect(createNewsSource("http://localhost:3000").list()).rejects.toThrow(
    "first source ingestion",
  );
});

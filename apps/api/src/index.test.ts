import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createDatabase: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@discords/db", () => ({ createDatabase: mocks.createDatabase }));
vi.mock("./config.ts", () => ({ ENV: { DATABASE_URL: "postgresql://test", PORT: 3000 } }));
vi.mock("./routes/news.ts", () => ({
  createNewsApp: () => ({ use: () => ({ listen: mocks.listen }) }),
}));
vi.mock("./routes/youtube.ts", () => ({ createYoutubeApp: () => ({}) }));

const makePool = () => ({
  query: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
  end: vi.fn().mockResolvedValue(undefined),
});
let pools: ReturnType<typeof makePool>[];

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NEWS_INTERNAL_TOKEN", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  pools = [makePool(), makePool(), makePool()];
  let index = 0;
  mocks.createDatabase.mockImplementation(() => ({ db: {}, pool: pools[index++] }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it("verifies both database pools before opening the HTTP listener", async () => {
  await import("./index.ts");
  for (const pool of pools.slice(0, 2)) {
    expect(pool.query).toHaveBeenCalledWith({ text: "SELECT 1", query_timeout: 5000 });
    expect(pool.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.listen.mock.invocationCallOrder[0]!,
    );
    expect(pool.end).not.toHaveBeenCalled();
  }
  expect(mocks.createDatabase).toHaveBeenCalledWith("postgresql://test", {
    connectionTimeoutMillis: 5000,
  });
  expect(pools[2]!.query).not.toHaveBeenCalled();
  expect(mocks.listen).toHaveBeenCalledWith(3000);
});

it("also verifies the optional internal pool", async () => {
  vi.stubEnv("NEWS_INTERNAL_TOKEN", "internal-token");
  await import("./index.ts");
  expect(pools[2]!.query).toHaveBeenCalledWith({ text: "SELECT 1", query_timeout: 5000 });
  expect(mocks.listen).toHaveBeenCalledOnce();
});

it("waits for a pending connection before listening", async () => {
  let connected!: () => void;
  const pending = new Promise<void>((resolve) => {
    connected = resolve;
  });
  pools[1]!.query.mockReturnValueOnce(pending);
  const startup = import("./index.ts");
  await vi.waitFor(() => expect(pools[1]!.query).toHaveBeenCalledOnce());
  expect(mocks.listen).not.toHaveBeenCalled();
  connected();
  await startup;
  expect(mocks.listen).toHaveBeenCalledOnce();
});

it("closes every pool and refuses to listen without exposing database errors", async () => {
  vi.stubEnv("NEWS_INTERNAL_TOKEN", "internal-token");
  pools[2]!.query.mockRejectedValueOnce(new Error("authentication failed: secret-password"));
  pools[0]!.end.mockRejectedValueOnce(new Error("close failed"));
  await expect(import("./index.ts")).rejects.toThrow(
    "Database connection check failed; API startup aborted.",
  );
  expect(mocks.listen).not.toHaveBeenCalled();
  for (const pool of pools) expect(pool.end).toHaveBeenCalledOnce();
});

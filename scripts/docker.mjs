import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

export function composeEnvironment(values) {
  const user = values.POSTGRES_USER;
  const database = values.POSTGRES_DB;
  const password = values.POSTGRES_PASSWORD;
  const port = Number(values.PORT);
  if (!user || !database || !password || password === "replace-with-a-local-password") {
    throw new Error("Set POSTGRES_USER, POSTGRES_DB, and POSTGRES_PASSWORD in apps/api/.env.");
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be between 1 and 65535 in apps/api/.env.");
  }
  const dockerUrl = new URL("postgresql://postgres:5432/");
  dockerUrl.username = user;
  dockerUrl.password = password;
  dockerUrl.pathname = `/${encodeURIComponent(database)}`;
  return {
    POSTGRES_USER: user,
    POSTGRES_DB: database,
    POSTGRES_PASSWORD: password,
    PORT: String(port),
    API_DATABASE_URL: dockerUrl.toString(),
    NEWS_CORS_ORIGINS: values.NEWS_CORS_ORIGINS ?? "",
    NEWS_INTERNAL_TOKEN: values.NEWS_INTERNAL_TOKEN ?? "",
    JOBS_INTERNAL_TOKEN: values.JOBS_INTERNAL_TOKEN ?? "",
    YOUTUBE_API_KEY: values.YOUTUBE_API_KEY ?? "",
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // The root package script invokes this file through `varlock run --inject vars`.
    // Do not parse `varlock load` output: sensitive values there may be redacted.
    const config = composeEnvironment(process.env);
    const args = process.argv.slice(2);
    if (args.includes("--profile") && args.includes("bot") && !config.NEWS_INTERNAL_TOKEN)
      throw new Error("Set NEWS_INTERNAL_TOKEN in apps/api/.env before starting the bot profile.");
    if (args.includes("--profile") && args.includes("bot") && !config.JOBS_INTERNAL_TOKEN)
      throw new Error("Set JOBS_INTERNAL_TOKEN in apps/api/.env before starting the bot profile.");
    const result = spawnSync("docker", ["compose", ...args], {
      cwd: projectRoot,
      env: { ...process.env, ...config },
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const compose = ["compose", "-f", "compose.test.yml", "-p", `discords-it-${process.pid}`];

function run(program, args, env = process.env) {
  const windowsNub = program === "nub" && process.platform === "win32";
  const result = spawnSync(windowsNub ? "cmd.exe" : program,
    windowsNub ? ["/d", "/s", "/c", `nub ${args.join(" ")}`] : args,
    { cwd, env, encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} exited ${result.status}`);
  return result.stdout.trim();
}

try {
  run("docker", [...compose, "up", "-d", "--wait", "--wait-timeout", "90"]);
  const binding = run("docker", [...compose, "port", "postgres-test", "5432"]);
  const port = Number(binding.match(/:(\d+)$/)?.[1]);
  if (!Number.isInteger(port) || !port) throw new Error(`Unexpected test PostgreSQL port: ${binding}`);
  const url = `postgresql://integration:integration-only-password@127.0.0.1:${port}/integration`;
  const env = { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url };
  run("nub", ["run", "db:migrate"], env);
  run("nub", ["run", "db:migrate"], env);
  run("nub", ["--cwd", "apps/api", "exec", "vitest", "run", "src/news/postgres.integration.test.ts", "src/youtube/postgres.integration.test.ts"], env);
  run("nub", ["--cwd", "apps/bot", "exec", "vitest", "run", "src/features/netmarble-news/postgres.integration.test.ts", "src/features/youtube-videos/postgres.integration.test.ts", "src/core/command-log-postgres.integration.test.ts", "src/features/tickets/ticket-closure-postgres.integration.test.ts"], env);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try {
    run("docker", [...compose, "down", "-v", "--remove-orphans"]);
  } catch (error) {
    console.error("Could not remove isolated PostgreSQL test service", error);
    process.exitCode = 1;
  }
}

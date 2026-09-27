import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

function loadVarlockEnvironment() {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "nub";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "nub --cwd apps/api exec varlock load --format json"]
    : ["--cwd", "apps/api", "exec", "varlock", "load", "--format", "json"];
  const result = spawnSync(command, args, { cwd: projectRoot, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error("Varlock could not validate apps/api/.env.schema and apps/api/.env.");
  }
  return JSON.parse(result.stdout);
}

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
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = composeEnvironment(loadVarlockEnvironment());
    const result = spawnSync("docker", ["compose", ...process.argv.slice(2)], {
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

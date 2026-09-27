import type { Client } from "discord.js";

type ShutdownProcess = {
  once(signal: NodeJS.Signals, listener: (signal: NodeJS.Signals) => void): unknown;
  exit(code?: number): void;
};

export function registerGracefulShutdown(
  client: Pick<Client, "destroy">,
  runtime: ShutdownProcess = process,
) {
  let stopping = false;

  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;

    console.log(`Stopping Discord bot (${signal}).`);
    client.destroy();
    runtime.exit(0);
  };

  runtime.once("SIGINT", shutdown);
  runtime.once("SIGTERM", shutdown);
}

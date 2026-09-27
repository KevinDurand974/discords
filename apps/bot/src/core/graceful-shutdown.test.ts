import { describe, expect, it, vi } from "vitest";
import { registerGracefulShutdown } from "./graceful-shutdown.ts";

describe("registerGracefulShutdown", () => {
  it("destroys the Discord client and exits once when receiving a termination signal", () => {
    const handlers = new Map<NodeJS.Signals, (signal: NodeJS.Signals) => void>();
    const runtime = {
      once: vi.fn((signal: NodeJS.Signals, handler: (signal: NodeJS.Signals) => void) => {
        handlers.set(signal, handler);
        return runtime as never;
      }),
      exit: vi.fn(),
    };
    const client = { destroy: vi.fn() };

    registerGracefulShutdown(client, runtime);
    handlers.get("SIGINT")!("SIGINT");
    handlers.get("SIGTERM")!("SIGTERM");

    expect(client.destroy).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledOnce();
    expect(runtime.exit).toHaveBeenCalledWith(0);
  });
});

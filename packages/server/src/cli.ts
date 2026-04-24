import { resolve } from "node:path";
import { createLogger } from "@mcp-conductor/core";
import { main } from "./main.js";

async function run(): Promise<void> {
  const log = createLogger("cli");
  const configPath = resolve(process.env.CONDUCTOR_CONFIG ?? "./conductor.json");
  log.info("starting", { configPath });
  try {
    await main(configPath, { manageSignals: true });
    // gateway owns signal handling via its own shutdown registry;
    // we just keep the process alive.
  } catch (err) {
    log.error("fatal startup error", { err });
    process.exit(1);
  }
}

run();

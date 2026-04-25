import { resolve } from "node:path";
import { createLogger } from "@mcp-conductor/core";
import { main } from "./main.js";
import { formatValidationResult, validateConfigFile } from "./validate.js";

function defaultConfigPath(): string {
  return resolve(process.env.CONDUCTOR_CONFIG ?? "./conductor.json");
}

async function runStart(): Promise<void> {
  const log = createLogger("cli");
  const configPath = defaultConfigPath();
  log.info("starting", { configPath });
  try {
    await main(configPath, { manageSignals: true });
  } catch (err) {
    log.error("fatal startup error", { err });
    process.exit(1);
  }
}

async function runValidate(args: string[]): Promise<void> {
  const positional = args.find((a) => !a.startsWith("-"));
  const configPath = resolve(positional ?? process.env.CONDUCTOR_CONFIG ?? "./conductor.json");
  const result = await validateConfigFile(configPath);
  process.stdout.write(formatValidationResult(configPath, result) + "\n");
  process.exit(result.ok ? 0 : 1);
}

function printHelp(): void {
  process.stdout.write(
    [
      "Usage: conductor [command] [options]",
      "",
      "Commands:",
      "  start                Start the gateway (default).",
      "  validate [path]      Validate conductor.json offline. Exits non-zero on errors.",
      "  help                 Show this help.",
      "",
      "Environment:",
      "  CONDUCTOR_CONFIG     Path to conductor.json. Default: ./conductor.json",
      "  PORT                 Override server.port at runtime.",
      "",
    ].join("\n"),
  );
}

async function dispatch(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
    case "start":
      await runStart();
      return;
    case "validate":
      await runValidate(rest);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n`);
      printHelp();
      process.exit(2);
  }
}

dispatch();

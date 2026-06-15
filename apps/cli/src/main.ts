#!/usr/bin/env bun
// The CLI entry: parse the args, dispatch to run / auth / help, wire the real
// runtime parts, and (for run) keep the process alive until Ctrl-C, then shut down
// and clean up. A thin shell (not tested); its decisions live in tested modules.
//
// It wires the runtime parts together, so the dependency-count rule is off here.
/* oxlint-disable import/max-dependencies */

import { runAuth } from "./commands/auth.js";
import { createLogger, type Logger } from "./logger.js";
import { type CliCommand, parseCli } from "./args/parse_cli.js";
import { orchestrateRun, type OrchestrateDeps } from "./run/orchestrate.js";
import type { RunArgs } from "./args/run_args.js";
import { startServer } from "./server/serve.js";
import {
  createAuthOps,
  distDir,
  ingestLocal,
  ingestPr,
  loadComments,
  loadConfig,
  openBrowser,
  pickPort,
  pollWait,
  randomId,
  realIdleClock,
  resolvePrAuth,
  streamEngine,
  submitReview,
} from "./runtime.js";

const USAGE = `codethrough - guided PR review

Usage:
  codethrough run [<pr-url> | <path>] [options]
  codethrough auth <login | logout | status>

Run options:
  --base <rev>      Base revision (local-path mode)
  --head <rev>      Head revision (local-path mode)
  --repo <path>     Local clone to reuse
  --model <id>      Anthropic model id
  --effort <level>  Reasoning effort: low | high | max
  --port <n>        Bind a specific port (default: a random free port)
  --no-open         Do not open the browser
`;

// Build the orchestrate deps from the run args and the real runtime parts. The
// idle window and poll interval come from config inside the run, not here.
const buildRunDeps = (args: RunArgs, logger: Logger): OrchestrateDeps => ({
  loadConfig,
  resolvePrAuth,
  ingestPr,
  loadComments,
  submitReview,
  ingestLocal,
  streamEngine,
  newSessionId: randomId,
  startServer,
  openBrowser,
  port: pickPort(args.port),
  token: randomId(),
  distDir: distDir(),
  wait: pollWait,
  idleClock: realIdleClock,
  log: (message) => logger.error(message),
});

// Resolve on Ctrl-C (SIGINT/SIGTERM) so the caller can shut down. Turning the OS
// signals into a promise needs new Promise.
const waitForSignal = (): Promise<void> =>
  // oxlint-disable-next-line promise/avoid-new
  new Promise((resolve) => {
    const stop = (): void => resolve();
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

// Run the `run` command: start it, print the URL, then wait for Ctrl-C or an idle
// timeout and shut down.
const doRun = async (args: RunArgs, logger: Logger): Promise<void> => {
  const deps = buildRunDeps(args, logger);
  const run = await orchestrateRun(args, deps);
  logger.info(`Codethrough is serving your review at ${run.url}`);
  logger.info("Press Ctrl-C to stop.");
  // Whichever happens first, a signal or an idle timeout, runs the same shutdown.
  await Promise.race([waitForSignal(), run.whenIdle]);
  logger.info("Shutting down ...");
  await run.shutdown();
};

// Run the `auth` command: build the real ops and dispatch.
const doAuth = async (command: "login" | "logout" | "status", logger: Logger): Promise<void> => {
  const ops = await createAuthOps();
  await runAuth(command, ops, logger);
};

// Dispatch a parsed command. Help prints usage; run/auth run their flows.
const dispatch = (command: CliCommand, logger: Logger): Promise<void> => {
  if (command.kind === "help") {
    logger.info(USAGE);
    return Promise.resolve();
  }
  if (command.kind === "auth") {
    return doAuth(command.command, logger);
  }
  return doRun(command.args, logger);
};

// Parse argv and run, mapping any thrown error to a stderr line + non-zero exit.
const main = async (): Promise<void> => {
  const logger = createLogger({ out: process.stdout, err: process.stderr });
  try {
    const command = parseCli(process.argv.slice(2));
    await dispatch(command, logger);
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
};

await main();

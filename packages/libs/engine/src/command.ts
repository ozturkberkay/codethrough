// The shapes the engine depends on, kept apart from any real code so the core never
// imports a concrete runner.

/** The result of running an external command. */
export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// The optional signal lets a caller put a time limit on a command (e.g. the per-tool
// timeout); callers that do not need it leave it out.
export type CommandRunner = (argv: string[], signal?: AbortSignal) => Promise<CommandResult>;

/**
 * Where each phase sends progress. The engine does not pick a destination, so the CLI
 * can plug in a real one and tests stay quiet. Defaults to doing nothing.
 */
export type EngineLogger = (message: string) => void;

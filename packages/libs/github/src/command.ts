// The shape of "run a command" that the secret stores and gh reuse depend on.
// The real runner lives in runtime.ts; tests pass a fake so every OS backend
// runs on any platform.

// The result of running an external command.
interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

// Optional stdin lets us pass secrets to a tool without putting them in argv,
// which anyone can read with `ps`.
type CommandRunner = (cmd: string, args: string[], stdin?: string) => Promise<RunResult>;

export type { CommandRunner, RunResult };

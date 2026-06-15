// A tiny logger. The CLI prints normal output to stdout and errors to stderr, so
// this wraps those two streams. They are injected so a test can capture the output.

// The little writable shape a logger needs.
interface WritableLike {
  write: (chunk: string) => unknown;
}

// The two streams a logger writes to. Injected so tests capture them.
interface LoggerStreams {
  out: WritableLike;
  err: WritableLike;
}

// What the CLI logs through. info goes to stdout; error goes to stderr. Both add a
// newline.
interface Logger {
  info: (message: string) => void;
  error: (message: string) => void;
}

// Build a logger over the streams. Each line is the message plus a newline.
const createLogger = (streams: LoggerStreams): Logger => ({
  info: (message) => {
    streams.out.write(`${message}\n`);
  },
  error: (message) => {
    streams.err.write(`${message}\n`);
  },
});

export { createLogger };
export type { Logger, LoggerStreams, WritableLike };

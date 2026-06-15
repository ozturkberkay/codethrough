# Codethrough

Codethrough is a local-first CLI that generates an AI guided walkthrough of a
GitHub pull request and serves an interactive review in your browser. It puts the
engineer at the center while holding their hand through the whole process to
reduce the cognitive burden of review.

The whole stack runs on your machine: the backend binds `127.0.0.1`, holds the
GitHub auth and `git`, and never sends your code anywhere except the model
provider you enable.

## Quickstart

```sh
brew install codethrough
codethrough run https://github.com/owner/repo/pull/123
```

Prerequisites:

- `git`
- A model provider. Today that is Anthropic, enabled with either an
  `ANTHROPIC_API_KEY` or your Claude subscription (be signed into the Claude CLI).
  See [Model providers](apps/cli/README.md#model-providers-integrations).

See the [CLI guide](apps/cli/README.md) for install, the full flag set,
the model providers, GitHub authentication, and configuration.

## Monorepo layout

| Path | What it is |
| --- | --- |
| `packages/libs/schema` | Valibot schemas and the contract shared across engine, backend, and UI. |
| `packages/libs/github` | Device-flow auth, OS keychain, Octokit wrapper, comment read and placement, review submit. |
| `packages/libs/engine` | The comprehension engine: ingest, hunk catalog, explore loop, and streamed compose. |
| `packages/libs/review` | The SolidJS review UI: the `@pierre/diffs` wiring, step navigation, summary, and comments. |
| `apps/cli` | The `codethrough` CLI: run command, local server, ingest, and the single-binary build. |
| `apps/landing` | The Astro landing page at [codethrough.dev](https://codethrough.dev/). |

## Development

```sh
bun install
```

The repo is a Bun + Turborepo workspace. The common tasks run across every
package:

| Task | Command |
| --- | --- |
| Build | `bun run turbo run build` |
| Type check | `bun run turbo run check` |
| Lint | `bun run turbo run lint` |
| Test | `bun run turbo run test` |

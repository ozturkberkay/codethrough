# codethrough

The `codethrough` CLI generates an AI guided walkthrough of a GitHub pull request
and serves an interactive review in your browser. It brings up a local backend on
`127.0.0.1`, runs the comprehension engine, and opens a rich `@pierre/diffs` view
where you step through the change, read existing review comments, and leave new
ones. The repository stays on your machine; only PR metadata and comments cross
the GitHub API, and only your code context (the part the model needs) reaches the
model provider you enable.

## Install

```sh
brew install codethrough
```

## Usage

```text
codethrough run [<pr-url> | <path>] [--base <rev>] [--head <rev>] [--repo <path>]
                [--model <id>] [--effort low|high|max] [--no-open] [--port <n>]
codethrough auth login | logout | status
```

### `codethrough run <pr-url>`

```sh
codethrough run https://github.com/owner/repo/pull/123
codethrough run owner/repo#123
```

Resolves the PR through the GitHub API, obtains a local checkout (a partial clone
to a temp directory when no local clone is found, cleaned up on shutdown), runs
the engine, then serves the review and opens your browser. Both the full
`https://github.com/<owner>/<repo>/pull/<number>` URL and the `owner/repo#number`
shorthand are accepted.

### `codethrough run <path>`

```sh
codethrough run .
codethrough run ./some/repo --base main --head feature
```

Runs the engine on a local working tree (or a `--base`...`--head` range) with no
GitHub and no comments.

### Flags

| Flag | Applies to | Meaning |
| --- | --- | --- |
| `--base <rev>` | path mode | The base revision of the local range. |
| `--head <rev>` | path mode | The head revision of the local range. |
| `--repo <path>` | both | The local repository path (a local clone to read instead of cloning, in PR mode). |
| `--model <id>` | both | The provider model id (default `claude-opus-4-8`). |
| `--effort low\|high\|max` | both | The reasoning effort for both engine phases (default `high`). |
| `--no-open` | both | Do not open the browser; the URL is printed instead. |
| `--port <n>` | both | Bind a specific loopback port (1-65535) instead of a free one. |

A bare `codethrough run` with no positional runs path mode on the current
directory.

## Model providers (integrations)

The model layer is a provider plugin: everything outside it sees one
vendor-neutral interface, so a new vendor is one adapter file and the rest of the
tool is untouched. The list below grows as providers are added.

- **Anthropic** (the only provider today). Enable it with **either** of:
    - **An API key.** `export ANTHROPIC_API_KEY=sk-ant-...`. The key is read
      straight from the environment.
    - **Your Claude subscription.** Be signed into the Claude CLI (run `claude`)
      and the tool auto-detects its OAuth token, so no key is needed. It looks,
      first hit wins, at `CLAUDE_CODE_OAUTH_TOKEN`, then `ANTHROPIC_AUTH_TOKEN`,
      then the Claude CLI's `~/.claude/.credentials.json`, then (on macOS) the
      Claude CLI's keychain item. Subscription use is best-effort while
      Anthropic's policy here is unsettled.

When no credential is found, the run stops with a message naming both options. An
expired subscription token is still tried, with a hint to run `claude` to refresh
it.

## GitHub authentication

```sh
codethrough auth login
codethrough auth status
codethrough auth logout
```

GitHub auth is our own: the CLI signs you in and keeps the token in your OS
credential store, so the GitHub CLI (`gh`) is **not** required. `auth login`
resolves a usable token by trying, in order:

1. **`gh`-token reuse (zero-config fast path).** If `gh` is present and
   authenticated, its token is reused, so anyone who already has `gh` gets no new
   prompt. This is a convenience, not a dependency.
2. **Stored credential.** Otherwise a previously stored token is used. The token
   does not expire, so once stored it keeps working until you log out.
3. **Device flow.** Otherwise you authorize once through our GitHub OAuth App with
   the OAuth 2.0 Device Authorization Grant (RFC 8628): the CLI prints a
   verification URL and a one-time code; you open the URL, approve the requested
   `repo` scope, and the token is stored in your OS credential store.

The OAuth App requests the `repo` scope. It is broad because OAuth Apps lack
fine-grained scopes, but it is what lets the same token read private and public
PRs and post review comments without any per-organization install step.

**Status today:** the device flow needs the Codethrough GitHub OAuth App
registered and its client id wired in (a maintainer setup step that is not done
yet), so the **`gh`-token reuse path is the one that works today.** Have `gh`
authenticated and sign-in is automatic; the device flow lights up once the App is
registered.

`auth status` reports whether you are authenticated, the token source, and your
GitHub login when reachable, without forcing a device flow. `auth logout` clears
the stored credential. The token itself is never printed; only its provenance is.

Tokens are stored in the OS credential store via a subprocess (macOS `security`,
Linux `secret-tool`, Windows `cmdkey` + DPAPI). Where no store exists, an
encrypted `0600` AES-256-GCM file under the config directory is the fallback.

### Reaching private organization repositories

Because this is an OAuth App, there is **no per-organization install step:** the
token reaches whatever you can already access, so a private org repo you are a
member of reads without any extra setup. An org owner can still restrict
OAuth-app access through the organization's third-party application policy, in
which case the token is limited until the org approves the app.

### Registering the OAuth App

In the GitHub OAuth App settings ([registering an OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)):

1. Enable the **Device Flow**
   ([device flow reference](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)).
2. Record the App's client id.

The CLI reads that client id from the `CODETHROUGH_GITHUB_CLIENT_ID` environment
variable, so an operator can point the binary at a registered App without a
rebuild. The OAuth scope defaults to `repo` and can be overridden with
`CODETHROUGH_GITHUB_SCOPES`.

## Configuration

Configuration is layered with this precedence (highest first):

```text
flags > env > project (.codethrough.toml) > user (~/.config/codethrough/config.toml) > defaults
```

The project file is `.codethrough.toml` in the current directory; the user file
is `~/.config/codethrough/config.toml`. Both carry the engine knobs under an
`[engine]` table:

```toml
[engine]
model = "claude-opus-4-8"
effort = "high"
max_hunks = 60
```

### Environment variables

| Variable | Effect |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic API key; one way to enable the Anthropic provider (see [Model providers](#model-providers-integrations)). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Claude subscription OAuth token; overrides the auto-detected one. |
| `ANTHROPIC_AUTH_TOKEN` | Alternate Claude subscription OAuth token, checked after `CLAUDE_CODE_OAUTH_TOKEN`. |
| `CODETHROUGH_MODEL` | Override the model id. |
| `CODETHROUGH_EFFORT` | Override the effort (`low`, `high`, or `max`). |
| `CODETHROUGH_MAX_HUNKS` | Override the hunk-count cap applied before the LLM phases (default 60). |
| `CODETHROUGH_IDLE_TIMEOUT_MS` | Override the idle-shutdown window (default 30 minutes). |
| `CODETHROUGH_GITHUB_CLIENT_ID` | The client id of the registered GitHub OAuth App, for the device flow. |
| `CODETHROUGH_GITHUB_SCOPES` | Override the OAuth scope requested in the device flow (default `repo`). |
| `CODETHROUGH_CONFIG_DIR` | Override the config directory used by the encrypted-file credential fallback. |
| `CODETHROUGH_FILE_KEY` | Extra key material for the encrypted-file credential fallback. |

The defaults are model `claude-opus-4-8`, effort `high`, and a hunk cap of 60.

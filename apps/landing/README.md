# Landing Page

The public face of Codethrough lives at
[https://codethrough.dev/](https://codethrough.dev/), served as a static
site from `apps/landing/`. The stack is Astro (static output) + Bun + Turborepo
with shared `@codethrough/*` packages under `packages/`.

## E2E tests

`bun run --filter=@codethrough/landing test:e2e` requires the local docker
stack to be up. Run `redeploy_local` first (or
`docker compose --profile landing up -d --wait`).

# @cube-ai/agent-sdk-client

> Framework-agnostic client for the Agentic Engine. Runs in Browser, Bun,
> Node, Deno, Cloudflare Workers. No DOM / no Vue / no React.

## Phase 0a scope

- `AgenticClient` (baseUrl + token + capability headers; `healthLive()` only)
- `parseSse()` line-based SSE parser yielding validated `SseEventBase` envelopes
- `AgenticError` 5-field error class (regulation §10.7 alignment)
- Canonical headers re-exported from `@cube-ai/contracts/versioning`

Full surface (sessions, turns, messages, grants, tool acks, jobs, SSE replay,
retry, refresh-token) lands in M1.C Phase 3 per `docs/detailed-design/08-sdk/sdk-core.md`.

## Build

```bash
bun run --filter @cube-ai/agent-sdk-client build
# → dist/index.js  (bun build target=browser, ESM, sourcemap)
# → dist/index.d.ts (tsc --emitDeclarationOnly)
```

## Consumers

- Web apps (Vue / React / Solid) via `@cube-ai/agent-sdk-client-vue`
- Server-side integrations via direct import
- Mock engine runner via `@cube-ai/agent-sdk-client-mock` (shares `AgenticError` + SSE helpers)

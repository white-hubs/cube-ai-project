# @cube-ai/agent-sdk-client-vue

> Vue 3 adapter over `@cube-ai/agent-sdk-client`. Browser-only.

## Phase 0a scope

- `provideAgenticClient({ baseUrl })` + `useAgenticClient()` (DI via `provide` / `inject`)
- `useHealthLive()` composable (loading / status / timestamp / refresh)

Full catalogue (sessions, turn streams, grants, jobs, tool acks, SSE replay
integration) lands in M1.C Phase 3 per `docs/detailed-design/08-sdk/sdk-vue.md`.

## Build

```bash
bun run --filter @cube-ai/agent-sdk-client-vue build
# → dist/index.js   (bun build target=browser, ESM, externalises vue + sdk-core + contracts)
# → dist/index.d.ts (tsc --emitDeclarationOnly)
```

Because `vue`, `@cube-ai/agent-sdk-client` and `@cube-ai/contracts` are
marked `--external` at build time, consumers must install them themselves
(peer-dep semantics without the "Cannot find module" footgun).

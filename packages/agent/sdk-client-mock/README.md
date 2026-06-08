# @cube-ai/agent-sdk-client-mock

> In-process mock engine for SDK tests and local demos. Target runtime: Bun.

## Phase 0a scope

- `startMockEngine({ scenario })` — spins up a Bun.serve listener answering
  `/health/live` + `/health/ready`; unknown routes return the canonical
  5-field error envelope.
- `HEALTH_UP`, `HEALTH_DEGRADED` deterministic scenarios.
- `MockScenario` contract shared across future turn-stream fixtures.

Expanded scenario catalogue (sessions, turns, tool acks, grants, SSE drain)
lands in M1.C Phase 3 per `docs/detailed-design/08-sdk/sdk-mock.md`.

## Build

```bash
bun run --filter @cube-ai/agent-sdk-client-mock build
# → dist/index.js   (bun build target=bun, uses Bun.serve)
# → dist/index.d.ts (tsc --emitDeclarationOnly)
```

## Using from tests

```ts
import { startMockEngine } from '@cube-ai/agent-sdk-client-mock';
import { AgenticClient } from '@cube-ai/agent-sdk-client';

const mock = await startMockEngine();
const client = new AgenticClient({ baseUrl: mock.url });
console.log(await client.healthLive()); // { status: 'UP', timestamp: ... }
await mock.stop();
```

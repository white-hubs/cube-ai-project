import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Application } from '@dangao/bun-server';
import {
  applyAiCenterTestEnv,
  restoreAiCenterTestEnv,
  snapshotAiCenterTestEnv,
} from '../test-helpers/ai-center-test-env';

/** Matches `packages/flow/core/src/mock/handlers/flows.mock.ts` MOCK_FLOW_ID */
const MOCK_FLOW_ID = '00000000-0000-4000-8000-000000000001';

describe('ai-center flow SSE (ADR-0004)', () => {
  let baseUrl = '';
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>['getServer']> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;

  beforeAll(async () => {
    envSnapshot = snapshotAiCenterTestEnv();
    applyAiCenterTestEnv(`${import.meta.dir}/.tmp-ai-center-flow-sse.sqlite`);
    process.env.CUBE_AI_MOCK_FLOWS = '1';

    ({ bootstrap } = await import('../bootstrap'));

    const port = 4300 + Math.floor(Math.random() * 500);
    app = await bootstrap({ port, hostname: '127.0.0.1' });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.stop?.();
    restoreAiCenterTestEnv(envSnapshot);
  });

  const authHeaders = {
    'content-type': 'application/json',
    'x-api-key': 'sk_cube_builtin_system_ChangeMeInProduction',
  };

  it('POST /flow/flows/:id/run with stream=true returns text/event-stream', async () => {
    const resp = await fetch(`${baseUrl}/flow/flows/${MOCK_FLOW_ID}/run`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ stream: true, input: 'loop4-sse-e2e' }),
    });

    expect(resp.status).toBe(200);
    const contentType = resp.headers.get('Content-Type') ?? '';
    expect(contentType.toLowerCase()).toContain('text/event-stream');

    const reader = resp.body?.getReader();
    expect(reader).toBeDefined();
    const { value } = await reader!.read();
    expect(value).toBeDefined();
    const chunk = new TextDecoder().decode(value);
    expect(chunk.length).toBeGreaterThan(0);
    await reader!.cancel();
  });
});

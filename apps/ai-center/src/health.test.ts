import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Application } from '@dangao/bun-server';
import {
  applyAiCenterTestEnv,
  restoreAiCenterTestEnv,
  snapshotAiCenterTestEnv,
} from './test-helpers/ai-center-test-env';

describe('ai-center health', () => {
  let baseUrl = '';
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>['getServer']> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;

  beforeAll(async () => {
    envSnapshot = snapshotAiCenterTestEnv();
    applyAiCenterTestEnv(`${import.meta.dir}/.tmp-ai-center-flow.sqlite`);

    ({ bootstrap } = await import('./bootstrap'));

    const port = 4100 + Math.floor(Math.random() * 500);
    app = await bootstrap({ port, hostname: '127.0.0.1' });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.stop?.();
    restoreAiCenterTestEnv(envSnapshot);
  });

  it('GET /health/live returns 200 UP', async () => {
    const resp = await fetch(`${baseUrl}/health/live`);
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { status?: string };
    expect(body.status).toBe('UP');
  });
});

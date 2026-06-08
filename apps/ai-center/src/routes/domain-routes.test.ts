import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Application } from '@dangao/bun-server';
import {
  applyAiCenterTestEnv,
  restoreAiCenterTestEnv,
  snapshotAiCenterTestEnv,
} from '../test-helpers/ai-center-test-env';

describe('ai-center domain routes', () => {
  let baseUrl = '';
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>['getServer']> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;

  beforeAll(async () => {
    envSnapshot = snapshotAiCenterTestEnv();
    applyAiCenterTestEnv(`${import.meta.dir}/.tmp-ai-center-domain.sqlite`);

    ({ bootstrap } = await import('../bootstrap'));

    const port = 4200 + Math.floor(Math.random() * 500);
    app = await bootstrap({ port, hostname: '127.0.0.1' });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.stop?.();
    restoreAiCenterTestEnv(envSnapshot);
  });

  const authHeaders = {
    'x-api-key': 'sk_cube_builtin_system_ChangeMeInProduction',
  };

  it('GET /flow/flows returns JSON list envelope', async () => {
    const resp = await fetch(`${baseUrl}/flow/flows`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /kb/documents returns JSON list envelope', async () => {
    const resp = await fetch(`${baseUrl}/kb/documents`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /llm/providers returns JSON list envelope', async () => {
    const resp = await fetch(`${baseUrl}/llm/providers`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('POST /v1/chat/completions returns OpenAI-shaped completion', async () => {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as {
      object?: string;
      choices?: Array<{ message?: { content?: string } }>;
    };
    expect(body.object).toBe('chat.completion');
    expect(body.choices?.[0]?.message?.content).toBeDefined();
  });
});

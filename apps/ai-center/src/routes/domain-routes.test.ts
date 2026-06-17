import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Application } from '@dangao/bun-server';
import {
  shouldRunAiCenterIntegration,
  startAiCenterIntegrationStack,
  stopAiCenterIntegrationStack,
} from '../test-helpers/ai-center-integration.harness';

const run = shouldRunAiCenterIntegration;

(run ? describe : describe.skip)('ai-center domain routes [testcontainers]', () => {
  let baseUrl = '';
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>['getServer']> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;

  beforeAll(async () => {
    ({ envSnapshot } = await startAiCenterIntegrationStack());

    ({ bootstrap } = await import('../bootstrap'));

    const port = 4200 + Math.floor(Math.random() * 500);
    app = await bootstrap({ port, hostname: '127.0.0.1' });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 180_000);

  afterAll(async () => {
    await server?.stop?.();
    await stopAiCenterIntegrationStack(envSnapshot);
  });

  const authHeaders = {
    'x-api-key': 'sk_cube_builtin_system_ChangeMeInProduction',
  };

  it('GET /flow/console/flows returns JSON list envelope', async () => {
    const resp = await fetch(`${baseUrl}/flow/console/flows`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /kb/console/documents returns JSON list envelope', async () => {
    const resp = await fetch(`${baseUrl}/kb/console/documents`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('GET /llm/console/providers returns JSON list envelope (catalog admin face)', async () => {
    const resp = await fetch(`${baseUrl}/llm/console/providers`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  // agent 管理面（/agent/console/*）：ai-center 装配期前缀挂载把 DescriptorManagementController
  // 挂到 `/agent/console`，descriptor console CRUD 对外路径为 `/agent/console/agents` 等。
  it('GET /agent/console/agents returns JSON items envelope (descriptor console face)', async () => {
    const resp = await fetch(`${baseUrl}/agent/console/agents`, { headers: authHeaders });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  // agent 消费面（/agent/*）：SessionController 挂到 `/agent/sessions`（agent-sdk-client 调用面）。
  it('GET /agent/sessions is reachable (agent consumption face)', async () => {
    const resp = await fetch(`${baseUrl}/agent/sessions`, { headers: authHeaders });
    expect(resp.status).toBe(200);
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

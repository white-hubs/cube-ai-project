/**
 * 端到端：真实 Engine + sdk-core（默认整文件 skip；解绑后去掉 describe.skip）。
 *
 * 前置：引擎已启动，`AGENTIC_ENGINE_URL`、`AGENTIC_AUTH_TOKEN`，端口建议 TEST_PORT=4015。
 *
 * Ref: P3-15-sdk-impl §6
 */
import { describe, expect, test } from 'bun:test';
import { createAgenticClient } from '../../src/client';

describe.skip('sdk-core × live engine（解 skip 后运行）', () => {
  test('healthLive → UP', async () => {
    const base = process.env.AGENTIC_ENGINE_URL ?? 'http://127.0.0.1:4015';
    const token = process.env.AGENTIC_AUTH_TOKEN ?? '';
    const client  = createAgenticClient({
      baseUrl: base,
      auth:    { provider: () => token },
    });
    const { status } = await client.healthLive();
    expect(status).toMatch(/UP|HEALTHY/i);
  });

  test('createSession → streamMessages → 收到 turn-completed-v1', async () => {
    const base  = process.env.AGENTIC_ENGINE_URL ?? 'http://127.0.0.1:4015';
    const token = process.env.AGENTIC_AUTH_TOKEN ?? '';
    const client = createAgenticClient({
      baseUrl: base,
      auth:    { provider: () => token },
      sse:     { maxReconnectAttempts: 5 },
    });

    const created = await client.sessions.create({
      agentId: '9100000000000000001',
    });

    const schemas: string[] = [];
    for await (const ev of client.sessions.streamMessages(
      created.id,
      {
        content: {
          schema: 'message-content-v1',
          blocks: [{ type: 'text', text: 'e2e ping' }],
        },
      },
    )) {
      schemas.push(ev.schema);
      if (ev.schema === 'turn-completed-v1') break;
    }

    expect(schemas.some(s => s.includes('completed') || s.includes('delta') || s.includes('started')))
      .toBe(true);
    expect(schemas).toContain('turn-completed-v1');
  });
});

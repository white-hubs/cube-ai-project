/**
 * Phase 3 infra — SIGTERM drain 链路；需独立子进程启停。
 * Q-M3-2：`describe.skip`，解开后验证 drain 事件名与退出码。
 */
import { describe, expect, test } from 'bun:test';

describe.skip('P3-01 graceful shutdown (integration)', () => {
  test('SIGTERM → server.draining SSE payload + process exit 0', async () => {
    const port = process.env.TEST_PORT ?? '4001';
    expect(port).toBeTruthy();
    // Expected manual flow:
    // 1) spawn `AGENTIC_ENGINE_PORT=${TEST_PORT} bun run src/main.ts`
    // 2) optional: open SSE session to receive server.draining
    // 3) kill -TERM child → exit code 0
    expect(Number(port)).toBeGreaterThan(0);
  });
});

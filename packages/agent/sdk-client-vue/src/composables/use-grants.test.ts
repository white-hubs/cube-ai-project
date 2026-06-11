/**
 * useGrants 单元测试（离线，纯响应式 — 不需要 DOM）：
 *   - handleEvent：grant-request-v1 → pendingGrant 落位；其它 schema 忽略
 *   - approve：透传 scopeChoice/rememberTtlSeconds/note、decision=APPROVE、清空 pending
 *   - deny：decision=DENY、清空 pending
 *   - 无 pending 时 approve/deny 不调用 client
 *   - effectScope dispose → pendingGrant 清空（卸载清理）
 */
import { describe, expect, test } from 'bun:test';
import { effectScope } from 'vue';
import type { AgenticClient } from '@cube-ai/agent-sdk-client';
import type { GrantRequestEvent, SseEvent } from '@cube-ai/contracts';
import { useGrants } from './use-grants';

function makeGrantEvent(overrides: Partial<GrantRequestEvent> = {}): GrantRequestEvent {
  return {
    schema: 'grant-request-v1',
    turnId: '20001',
    grantRequestId: '30001',
    toolName: 'delete_file',
    reason: 'destructive op',
    argsPreview: { path: '/tmp/x' },
    scopeHint: 'ONCE',
    expiresTime: Date.now() + 60_000,
    ...overrides,
  };
}

interface RespondCall {
  grantRequestId: string;
  decision: 'APPROVE' | 'DENY';
  scopeChoice?: 'ONCE' | 'SESSION' | 'PERSISTENT';
  rememberTtlSeconds?: number;
  note?: string;
}

function stubClient(): { client: AgenticClient; calls: RespondCall[] } {
  const calls: RespondCall[] = [];
  const client = {
    grants: {
      respond: async (req: RespondCall) => {
        calls.push(req);
      },
    },
  } as unknown as AgenticClient;
  return { client, calls };
}

describe('useGrants', () => {
  test('handleEvent: grant-request-v1 设置 pendingGrant；其它事件忽略', () => {
    const { client } = stubClient();
    const scope = effectScope();
    const api = scope.run(() => useGrants(client))!;
    expect(api.pendingGrant.value).toBeNull();

    api.handleEvent({ schema: 'turn-started-v1', turnId: '20001' } as unknown as SseEvent);
    expect(api.pendingGrant.value).toBeNull();

    const ev = makeGrantEvent();
    api.handleEvent(ev);
    expect(api.pendingGrant.value).toEqual(ev);
    scope.stop();
  });

  test('后到的 grant-request-v1 覆盖前一个 pendingGrant', () => {
    const { client } = stubClient();
    const scope = effectScope();
    const api = scope.run(() => useGrants(client))!;
    api.handleEvent(makeGrantEvent({ grantRequestId: '30001' }));
    api.handleEvent(makeGrantEvent({ grantRequestId: '30002' }));
    expect(api.pendingGrant.value?.grantRequestId).toBe('30002');
    scope.stop();
  });

  test('approve: decision=APPROVE + 透传 opts + 清空 pending', async () => {
    const { client, calls } = stubClient();
    const scope = effectScope();
    const api = scope.run(() => useGrants(client))!;
    api.handleEvent(makeGrantEvent({ grantRequestId: '30009' }));

    await api.approve({ scopeChoice: 'SESSION', rememberTtlSeconds: 600, note: 'ok' });
    expect(calls).toEqual([
      {
        grantRequestId: '30009',
        decision: 'APPROVE',
        scopeChoice: 'SESSION',
        rememberTtlSeconds: 600,
        note: 'ok',
      },
    ]);
    expect(api.pendingGrant.value).toBeNull();
    scope.stop();
  });

  test('deny: decision=DENY + note + 清空 pending', async () => {
    const { client, calls } = stubClient();
    const scope = effectScope();
    const api = scope.run(() => useGrants(client))!;
    api.handleEvent(makeGrantEvent({ grantRequestId: '30010' }));

    await api.deny({ note: 'nope' });
    expect(calls).toEqual([
      { grantRequestId: '30010', decision: 'DENY', note: 'nope' },
    ]);
    expect(api.pendingGrant.value).toBeNull();
    scope.stop();
  });

  test('无 pending 时 approve/deny 不调用 client', async () => {
    const { client, calls } = stubClient();
    const scope = effectScope();
    const api = scope.run(() => useGrants(client))!;
    await api.approve();
    await api.deny();
    expect(calls.length).toBe(0);
    scope.stop();
  });

  test('scope dispose → pendingGrant 清空（卸载清理）', () => {
    const { client } = stubClient();
    const scope = effectScope();
    const api = scope.run(() => useGrants(client))!;
    api.handleEvent(makeGrantEvent());
    expect(api.pendingGrant.value).not.toBeNull();
    scope.stop();
    expect(api.pendingGrant.value).toBeNull();
  });
});

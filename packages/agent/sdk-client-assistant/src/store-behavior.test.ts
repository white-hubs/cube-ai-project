/**
 * AssistantStore 行为边界补充测试：
 *   - lifecycle（reset / dispose / 订阅退订 / listener 容错）
 *   - loadSessions / setModels / autoLoad bootstrap
 *   - send / cancel / deleteSession / patchSession 边界
 *   - 事件 reducer 边界（message-completed / turn-started / usage-delta-v1 /
 *     tool-use-* / 未知事件 / 非法 grant / debugEventBuffer）
 *   - 断流强关（StreamDisconnectedError）与 placeholder id 兜底解析
 *
 * 沿用 store.test.ts 的 fake port 思路；本文件的 fake 额外支持把错误
 * **真正 reject** 进 for-await（断流路径需要）。
 */
import { describe, expect, test } from 'bun:test';
import { createAssistantStore, AssistantStore } from './store';
import { createMemoryReasoningStore } from './reasoning-store';
import { StoreDisposedError, StreamDisconnectedError } from '@cube-ai/agent-sdk-client';
import type {
  AssistantEnginePort,
  GrantResponseInput,
  NormalizedSseEvent,
  PortMessageItem,
} from './port';
import type { AssistantMessage, AssistantSessionSummary } from './types';
import type { AssistantState } from './store';

interface FakeStream {
  push(ev: NormalizedSseEvent): void;
  end(): void;
  fail(err: Error): void;
}

interface FakePort {
  port: AssistantEnginePort;
  pushEvent: (sessionId: string, ev: NormalizedSseEvent) => void;
  endStream: (sessionId: string) => void;
  failStream: (sessionId: string, e: Error) => void;
  setMessages: (sessionId: string, items: PortMessageItem[]) => void;
  calls: {
    startTurn: Array<{ sessionId: string; body: unknown }>;
    cancelTurn: Array<{ sessionId: string; turnId: string }>;
    listMessages: Array<{ sessionId: string }>;
    listSessions: number;
    patchSession: Array<{ sessionId: string; patch: unknown }>;
    deleteSession: string[];
    respondGrant: GrantResponseInput[];
  };
  streamCount: () => number;
}

function makeFakePort(initial: {
  sessions?: AssistantSessionSummary[];
  messages?: Record<string, PortMessageItem[]>;
} = {}): FakePort {
  const streams = new Map<string, FakeStream>();
  const turnCounter = { n: 1000 };
  const calls: FakePort['calls'] = {
    startTurn: [],
    cancelTurn: [],
    listMessages: [],
    listSessions: 0,
    patchSession: [],
    deleteSession: [],
    respondGrant: [],
  };
  let sessions = initial.sessions ?? [];
  const messages: Record<string, PortMessageItem[]> = { ...(initial.messages ?? {}) };

  const port: AssistantEnginePort = {
    startTurn: async (sessionId, body) => {
      calls.startTurn.push({ sessionId, body });
      return { turnId: String(++turnCounter.n) };
    },
    streamEvents: (sessionId, opts) => {
      const queue: NormalizedSseEvent[] = [];
      const resolvers: Array<{
        resolve: (v: IteratorResult<NormalizedSseEvent>) => void;
        reject: (e: Error) => void;
      }> = [];
      let done = false;
      let pendingError: Error | null = null;
      const handle: FakeStream = {
        push(ev) {
          if (done) return;
          const r = resolvers.shift();
          if (r) r.resolve({ value: ev, done: false });
          else queue.push(ev);
        },
        end() {
          if (done) return;
          done = true;
          while (resolvers.length > 0) {
            resolvers.shift()!.resolve({
              value: undefined as unknown as NormalizedSseEvent,
              done: true,
            });
          }
        },
        fail(err) {
          if (done) return;
          done = true;
          if (streams.get(sessionId) === handle) streams.delete(sessionId);
          if (resolvers.length > 0) {
            resolvers.shift()!.reject(err);
            while (resolvers.length > 0) {
              resolvers.shift()!.resolve({
                value: undefined as unknown as NormalizedSseEvent,
                done: true,
              });
            }
          } else {
            pendingError = err;
          }
        },
      };
      streams.set(sessionId, handle);
      const cleanup = (): void => {
        if (streams.get(sessionId) === handle) streams.delete(sessionId);
      };
      const iter: AsyncIterableIterator<NormalizedSseEvent> = {
        [Symbol.asyncIterator]() {
          return iter;
        },
        next(): Promise<IteratorResult<NormalizedSseEvent>> {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (pendingError) {
            const e = pendingError;
            pendingError = null;
            cleanup();
            return Promise.reject(e);
          }
          if (done || opts?.signal?.aborted === true) {
            cleanup();
            return Promise.resolve({
              value: undefined as unknown as NormalizedSseEvent,
              done: true,
            });
          }
          return new Promise((resolve, reject) => {
            resolvers.push({ resolve, reject });
            opts?.signal?.addEventListener(
              'abort',
              () => {
                const idx = resolvers.findIndex((r) => r.resolve === resolve);
                if (idx >= 0) {
                  resolvers.splice(idx, 1);
                  cleanup();
                  resolve({
                    value: undefined as unknown as NormalizedSseEvent,
                    done: true,
                  });
                }
              },
              { once: true },
            );
          });
        },
        return(): Promise<IteratorResult<NormalizedSseEvent>> {
          done = true;
          cleanup();
          return Promise.resolve({
            value: undefined as unknown as NormalizedSseEvent,
            done: true,
          });
        },
      };
      return iter;
    },
    listMessages: async (sessionId) => {
      calls.listMessages.push({ sessionId });
      return { items: messages[sessionId] ?? [] };
    },
    createSession: async (req) => ({
      id: `sess-${sessions.length + 1}`,
      title: req.title ?? '',
      createTime: Date.now(),
    }),
    listSessions: async () => {
      calls.listSessions += 1;
      return { items: sessions, hasMore: false };
    },
    getSession: async (id) => sessions.find((s) => s.id === id) ?? null,
    patchSession: async (sessionId, patch) => {
      calls.patchSession.push({ sessionId, patch });
      sessions = sessions.map((s) =>
        s.id === sessionId && typeof patch.title === 'string'
          ? { ...s, title: patch.title }
          : s,
      );
    },
    deleteSession: async (sessionId) => {
      calls.deleteSession.push(sessionId);
    },
    cancelTurn: async (sessionId, turnId) => {
      calls.cancelTurn.push({ sessionId, turnId });
    },
    respondGrant: async (input) => {
      calls.respondGrant.push(input);
    },
  };
  return {
    port,
    pushEvent: (sessionId, ev) => streams.get(sessionId)?.push(ev),
    endStream: (sessionId) => streams.get(sessionId)?.end(),
    failStream: (sessionId, e) => streams.get(sessionId)?.fail(e),
    setMessages: (sessionId, items) => {
      messages[sessionId] = items;
    },
    calls,
    streamCount: () => streams.size,
  };
}

async function nextTick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

function lastAssistant(store: AssistantStore, sessionId: string): AssistantMessage | undefined {
  const msgs = (store.getState().messagesBySessionId[sessionId] ?? []) as AssistantMessage[];
  return [...msgs].reverse().find((m) => m.role === 'assistant');
}

describe('AssistantStore — lifecycle 边界', () => {
  test('reset() 清空 state、关闭活跃 stream，并通知订阅者', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    expect(fake.streamCount()).toBe(1);
    const states: AssistantState[] = [];
    store.subscribe((s) => states.push(s));
    store.reset();
    await nextTick();
    expect(fake.streamCount()).toBe(0);
    const final = store.getState();
    expect(final.currentSessionId).toBeNull();
    expect(final.sessions).toEqual([]);
    expect(final.messagesBySessionId).toEqual({});
    expect(final.sending).toBe(false);
    expect(states.length).toBeGreaterThanOrEqual(2); // 订阅即时 + reset emit
    store.dispose();
  });

  test('dispose() 幂等；之后所有语义方法抛 StoreDisposedError', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    store.dispose();
    store.dispose(); // 第二次不抛
    expect(store.send('x')).rejects.toThrow(StoreDisposedError);
    expect(store.loadSessions()).rejects.toThrow(StoreDisposedError);
    expect(store.openSession('s')).rejects.toThrow(StoreDisposedError);
    expect(store.createSession({ agentId: 'a' })).rejects.toThrow(StoreDisposedError);
    expect(store.deleteSession('s')).rejects.toThrow(StoreDisposedError);
    expect(store.patchSession('s', { title: 't' })).rejects.toThrow(StoreDisposedError);
    expect(store.cancel()).rejects.toThrow(StoreDisposedError);
    expect(
      store.respondGrant({ grantRequestId: 'g', decision: 'APPROVE' }),
    ).rejects.toThrow(StoreDisposedError);
    expect(() => store.setModels([])).toThrow(StoreDisposedError);
    expect(() => store.setLoadingModels(true)).toThrow(StoreDisposedError);
    expect(() => store.reset()).toThrow(StoreDisposedError);
  });

  test('dispose() 关闭活跃 stream 并清空 listeners（不再 emit）', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    expect(fake.streamCount()).toBe(1);
    store.dispose();
    await nextTick();
    expect(fake.streamCount()).toBe(0);
  });

  test('unsubscribe 后不再收到通知', () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port });
    let count = 0;
    const unsub = store.subscribe(() => {
      count += 1;
    });
    expect(count).toBe(1); // subscribe 即时回放
    unsub();
    store.setModels([]);
    expect(count).toBe(1);
    store.dispose();
  });

  test('emit 时某个 listener 抛错被吞，不影响其它 listener', () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port });
    let badCalls = 0;
    let goodCalls = 0;
    store.subscribe(() => {
      badCalls += 1;
      if (badCalls > 1) throw new Error('listener boom'); // 仅后续 emit 抛
    });
    store.subscribe(() => {
      goodCalls += 1;
    });
    expect(() => store.setLoadingModels(true)).not.toThrow();
    expect(badCalls).toBe(2);
    expect(goodCalls).toBe(2); // 订阅即时 + setLoadingModels emit
    store.dispose();
  });
});

describe('AssistantStore — loadSessions / models', () => {
  test('loadSessions 设置 loading true→false 并覆盖 sessions', async () => {
    const fake = makeFakePort({
      sessions: [{ id: 's1', title: 't1', updatedAt: 1 }],
    });
    const store = createAssistantStore({ engine: fake.port });
    const loadingSeq: boolean[] = [];
    store.subscribe((s) => loadingSeq.push(s.loadingSessions));
    await store.loadSessions();
    expect(loadingSeq).toContain(true);
    const s = store.getState();
    expect(s.loadingSessions).toBe(false);
    expect(s.sessions).toHaveLength(1);
    expect(s.sessions[0]?.id).toBe('s1');
    store.dispose();
  });

  test('loadSessions 失败 → loadingSessions 复位 false 且错误向上抛（finally 兜底）', async () => {
    const fake = makeFakePort();
    fake.port.listSessions = async () => {
      throw new Error('network down');
    };
    const store = createAssistantStore({ engine: fake.port });
    expect(store.loadSessions()).rejects.toThrow('network down');
    await nextTick();
    expect(store.getState().loadingSessions).toBe(false);
    store.dispose();
  });

  test('setModels / setLoadingModels 走 setState 链路', () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port });
    store.setLoadingModels(true);
    expect(store.getState().loadingModels).toBe(true);
    store.setModels([
      { modelCode: 'gpt-x', displayName: 'GPT X', providerName: 'openai' },
    ]);
    store.setLoadingModels(false);
    const s = store.getState();
    expect(s.models).toHaveLength(1);
    expect(s.models[0]?.modelCode).toBe('gpt-x');
    expect(s.loadingModels).toBe(false);
    store.dispose();
  });
});

describe('AssistantStore — autoLoad bootstrap', () => {
  test("autoLoad:'sessions' → 仅 listSessions，不打开 session", async () => {
    const fake = makeFakePort({
      sessions: [{ id: 's1', title: 't1', updatedAt: 1 }],
    });
    const store = createAssistantStore({ engine: fake.port, autoLoad: 'sessions' });
    await nextTick();
    expect(fake.calls.listSessions).toBe(1);
    const s = store.getState();
    expect(s.sessions).toHaveLength(1);
    expect(s.currentSessionId).toBeNull();
    expect(fake.calls.listMessages).toHaveLength(0);
    store.dispose();
  });

  test("autoLoad:'sessions-and-first' → 打开第一个 session 并拉取消息", async () => {
    const fake = makeFakePort({
      sessions: [
        { id: 's1', title: 't1', updatedAt: 2 },
        { id: 's2', title: 't2', updatedAt: 1 },
      ],
      messages: {
        s1: [{ id: 'm1', role: 'assistant', content: 'hi', createTime: 1 }],
      },
    });
    const store = createAssistantStore({
      engine: fake.port,
      autoLoad: 'sessions-and-first',
    });
    await nextTick();
    const s = store.getState();
    expect(s.currentSessionId).toBe('s1');
    expect(s.messagesBySessionId['s1']).toHaveLength(1);
    store.dispose();
  });

  test('autoLoad bootstrap 中 listSessions 抛错被吞（构造不抛）', async () => {
    const fake = makeFakePort();
    fake.port.listSessions = async () => {
      throw new Error('boom');
    };
    const store = createAssistantStore({ engine: fake.port, autoLoad: 'sessions' });
    await nextTick();
    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().loadingSessions).toBe(false);
    store.dispose();
  });
});

describe('AssistantStore — send / createSession / cancel 边界', () => {
  test('createSession 无 agentId 且无 defaultAgentId → 抛错', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port });
    expect(store.createSession({})).rejects.toThrow(/agentId is required/);
    store.dispose();
  });

  test('send 纯空白且无附件 → 抛错且不产生任何占位消息', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    expect(store.send('   ')).rejects.toThrow(/non-empty text/);
    await nextTick();
    expect(store.getState().messagesBySessionId).toEqual({});
    expect(fake.calls.startTurn).toHaveLength(0);
    store.dispose();
  });

  test('send 用自定义 deriveTitleFromText 推导新会话标题', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({
      engine: fake.port,
      defaultAgentId: 'a',
      deriveTitleFromText: (text) => `[T] ${text.slice(0, 4)}`,
    });
    await store.send('hello world');
    await nextTick();
    expect(store.getState().sessions[0]?.title).toBe('[T] hell');
    // 首条用户消息会再 patchSession 一次（同一推导函数）
    expect(fake.calls.patchSession[0]?.patch).toEqual({ title: '[T] hell' });
    store.dispose();
  });

  test('send startTurn 抛普通 Error → 占位回滚 + sending=false + 原错误抛出', async () => {
    const fake = makeFakePort();
    fake.port.startTurn = async () => {
      throw new Error('plain failure');
    };
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    let err: unknown;
    try {
      await store.send('hello');
    } catch (e) {
      err = e;
    }
    expect((err as Error).message).toBe('plain failure');
    const s = store.getState();
    expect(s.sending).toBe(false);
    expect(s.messagesBySessionId['sess-1'] ?? []).toEqual([]);
    expect(s.activeTurnIdBySessionId['sess-1']).toBeUndefined();
    store.dispose();
  });

  test('cancel：无 currentSessionId → no-op', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port });
    await store.cancel();
    expect(fake.calls.cancelTurn).toHaveLength(0);
    store.dispose();
  });

  test('cancel：有 session 但无 activeTurnId → no-op', async () => {
    const fake = makeFakePort({
      sessions: [{ id: 's1', title: 't', updatedAt: 1 }],
    });
    const store = createAssistantStore({ engine: fake.port });
    await store.openSession('s1');
    await store.cancel();
    expect(fake.calls.cancelTurn).toHaveLength(0);
    store.dispose();
  });

  test('cancel：engine.cancelTurn 抛错被吞 + sending=false + stream 兜底关闭', async () => {
    const fake = makeFakePort();
    fake.port.cancelTurn = async () => {
      throw new Error('cancel http 500');
    };
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    expect(fake.streamCount()).toBe(1);
    await store.cancel(); // 不抛
    await nextTick();
    expect(store.getState().sending).toBe(false);
    expect(fake.streamCount()).toBe(0);
    store.dispose();
  });
});

describe('AssistantStore — deleteSession / patchSession', () => {
  test('删除当前 session → currentSessionId=null、per-session map 清空、stream 关闭', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q'); // 自动创建 sess-1 + 开 stream
    await nextTick();
    expect(fake.streamCount()).toBe(1);
    await store.deleteSession('sess-1');
    await nextTick();
    const s = store.getState();
    expect(fake.calls.deleteSession).toEqual(['sess-1']);
    expect(s.currentSessionId).toBeNull();
    expect(s.sessions.find((x) => x.id === 'sess-1')).toBeUndefined();
    expect(s.messagesBySessionId['sess-1']).toBeUndefined();
    expect(s.sendingBySessionId['sess-1']).toBeUndefined();
    expect(s.activeTurnIdBySessionId['sess-1']).toBeUndefined();
    expect(s.lastTurnStatusBySessionId['sess-1']).toBeUndefined();
    expect(s.toolEventsBySessionId['sess-1']).toBeUndefined();
    expect(s.sending).toBe(false);
    expect(fake.streamCount()).toBe(0);
    store.dispose();
  });

  test('删除非当前 session → currentSessionId 保留', async () => {
    const fake = makeFakePort({
      sessions: [
        { id: 's1', title: 't1', updatedAt: 1 },
        { id: 's2', title: 't2', updatedAt: 2 },
      ],
    });
    const store = createAssistantStore({ engine: fake.port });
    await store.loadSessions();
    await store.openSession('s1');
    await store.deleteSession('s2');
    const s = store.getState();
    expect(s.currentSessionId).toBe('s1');
    expect(s.sessions.map((x) => x.id)).toEqual(['s1']);
    store.dispose();
  });

  test('patchSession 带 title → 同步更新 state.sessions；仅 status → sessions 不变', async () => {
    const fake = makeFakePort({
      sessions: [{ id: 's1', title: 'old', updatedAt: 1 }],
    });
    const store = createAssistantStore({ engine: fake.port });
    await store.loadSessions();
    await store.patchSession('s1', { title: 'renamed' });
    expect(store.getState().sessions[0]?.title).toBe('renamed');
    await store.patchSession('s1', { status: 'CLOSED' });
    expect(store.getState().sessions[0]?.title).toBe('renamed');
    expect(fake.calls.patchSession).toHaveLength(2);
    store.dispose();
  });
});

describe('AssistantStore — 事件 reducer 边界', () => {
  test('message-completed-v1 → 替换 placeholder id + 覆盖最终 content', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'message-completed-v1',
      data: {
        messageId: 'srv-done',
        turnId: '1001',
        content: [{ type: 'text', text: 'final answer' }],
      },
    });
    await nextTick();
    const assistant = lastAssistant(store, 'sess-1');
    expect(assistant?.id).toBe('srv-done');
    expect(assistant?.turnId).toBe('1001');
    expect(assistant?.content).toBe('final answer');
    store.dispose();
  });

  test('message-completed-v1 content 为空 → 保留流式已积累 content', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'partial' } },
    });
    fake.pushEvent('sess-1', {
      event: 'message-completed-v1',
      data: { messageId: 'srv-1' },
    });
    await nextTick();
    const assistant = lastAssistant(store, 'sess-1');
    expect(assistant?.content).toBe('partial');
    store.dispose();
  });

  test('turn-started-v1 → activeTurnId 更新 + tokenUsage 初始化为零三元组', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'turn-started-v1',
      data: { turnId: '1001' },
    });
    await nextTick();
    const s = store.getState();
    expect(s.activeTurnIdBySessionId['sess-1']).toBe('1001');
    expect(s.lastTurnStatusBySessionId['sess-1']).toBe('running');
    const usage = s.tokenUsageBySessionId['sess-1'];
    expect(usage?.turnId).toBe('1001');
    expect(usage?.cumulative).toEqual({ input: 0, output: 0, total: 0 });
    expect(usage?.items).toEqual([]);
    store.dispose();
  });

  test('usage-delta-v1（旧名）与 v2 同 reducer：负数 / 小数截断为非负整数', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'usage-delta-v1',
      data: {
        turnId: '1001',
        usage: { input: 10.9, output: -5, total: 10.9 },
        cumulative: { input: 10.9, output: -5, total: 10.9 },
        attribution: { id: 'llm-1', kind: 'llm_call' },
      },
    });
    await nextTick();
    const usage = store.getState().tokenUsageBySessionId['sess-1'];
    expect(usage?.cumulative).toEqual({ input: 10, output: 0, total: 10 });
    expect(usage?.items).toHaveLength(1);
    store.dispose();
  });

  test('usage-delta 无 cumulative → 整条忽略', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    const before = store.getState().tokenUsageBySessionId['sess-1'] ?? null;
    fake.pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: { turnId: '1001', usage: { input: 5, output: 1, total: 6 } },
    });
    await nextTick();
    expect(store.getState().tokenUsageBySessionId['sess-1'] ?? null).toEqual(before);
    store.dispose();
  });

  test('usage-delta 用 delta:{input,output} 兜底合成 usage 三元组', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        delta: { input: 7, output: 3 },
        cumulative: { input: 7, output: 3, total: 10 },
        attribution: { id: 'llm-1', kind: 'llm_call' },
      },
    });
    await nextTick();
    const usage = store.getState().tokenUsageBySessionId['sess-1'];
    expect(usage?.items[0]?.usage).toEqual({ input: 7, output: 3, total: 10 });
    store.dispose();
  });

  test('未知事件 → 不影响 state（消息 / usage / grants 原样）', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    const before = store.getState();
    fake.pushEvent('sess-1', {
      event: 'mystery-event-v9',
      data: { foo: 'bar' },
    });
    await nextTick();
    const after = store.getState();
    expect(after.messagesBySessionId).toEqual(before.messagesBySessionId);
    expect(after.pendingGrants).toEqual(before.pendingGrants);
    expect(after.tokenUsageBySessionId).toEqual(before.tokenUsageBySessionId);
    store.dispose();
  });

  test('grant-request-v1 缺 grantRequestId → 忽略', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'grant-request-v1',
      data: { toolName: 't1', reason: 'why' },
    });
    await nextTick();
    expect(store.getState().pendingGrants).toHaveLength(0);
    expect(store.getState().awaitingGrant).toBe(false);
    store.dispose();
  });

  test('respondGrant：engine 抛错被吞，pendingGrant 仍已移除（SSE 重发自然纠正）', async () => {
    const fake = makeFakePort();
    fake.port.respondGrant = async () => {
      throw new Error('grant http 500');
    };
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'grant-request-v1',
      data: { grantRequestId: 'gr-1' },
    });
    await nextTick();
    expect(store.getState().pendingGrants).toHaveLength(1);
    await store.respondGrant({ grantRequestId: 'gr-1', decision: 'DENY' }); // 不抛
    expect(store.getState().pendingGrants).toHaveLength(0);
    store.dispose();
  });

  test('tool-use-started/completed-v1 → 仅进 toolEvents timeline，不折进 reasoning', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'tool-use-started-v1',
      data: { toolUseId: 'tu-1', toolName: 'web.search', time: 10, turnId: '1001' },
    });
    fake.pushEvent('sess-1', {
      event: 'tool-use-completed-v1',
      data: { toolUseId: 'tu-1', toolName: 'web.search', time: 20, resultPreview: 'ok' },
    });
    await nextTick();
    const s = store.getState();
    expect(s.toolEventsBySessionId['sess-1']).toHaveLength(1);
    expect(s.toolEventsBySessionId['sess-1']?.[0]).toMatchObject({
      id: 'tu-1',
      toolName: 'web.search',
      phase: 'completed',
      startedAt: 10,
      completedAt: 20,
      resultPreview: 'ok',
      turnId: '1001',
    });
    expect(lastAssistant(store, 'sess-1')?.reasoning?.steps ?? []).toHaveLength(0);
    store.dispose();
  });

  test('tool-call-completed-v1 无先行 started → 直接补 completed 条目', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'tool-call-completed-v1',
      data: {
        toolCallId: 'tc-orphan',
        toolName: 'platform.search',
        time: 99,
        output: { n: 1 },
        turnId: '1001',
      },
    });
    await nextTick();
    const events = store.getState().toolEventsBySessionId['sess-1'] ?? [];
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: 'tc-orphan',
      phase: 'completed',
      startedAt: 99,
      completedAt: 99,
      resultPreview: { n: 1 },
    });
    store.dispose();
  });

  test('tool 事件缺所有 id 字段 → 忽略', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'tool-use-started-v1',
      data: { toolName: 'x' },
    });
    await nextTick();
    expect(store.getState().toolEventsBySessionId['sess-1'] ?? []).toHaveLength(0);
    store.dispose();
  });

  test('debugEventBuffer：超过 max 截断保留最新 N 条', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({
      engine: fake.port,
      defaultAgentId: 'a',
      debugEventBuffer: { max: 2 },
    });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', { event: 'turn-started-v1', data: { turnId: '1001' } });
    fake.pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'm', delta: { type: 'text', text: 'a' } },
    });
    fake.pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'm', delta: { type: 'text', text: 'b' } },
    });
    await nextTick();
    const dbg = store.getState().debugEvents;
    expect(dbg).toHaveLength(2);
    expect(dbg.map((d) => d.event)).toEqual(['message-delta-v1', 'message-delta-v1']);
    store.dispose();
  });

  test('debugEventBuffer 缺省关闭 → debugEvents 恒为空', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', { event: 'turn-started-v1', data: { turnId: '1001' } });
    await nextTick();
    expect(store.getState().debugEvents).toHaveLength(0);
    store.dispose();
  });
});

describe('AssistantStore — 断流 / placeholder 兜底', () => {
  test('StreamDisconnectedError → sending=false + 活跃 reasoning step 强制 END（ok=false / STREAM_DISCONNECTED）', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'open-step', kind: 'phase', event: 'START', time: 1 },
    });
    await nextTick();
    fake.failStream('sess-1', new StreamDisconnectedError('conn lost'));
    await nextTick();
    const s = store.getState();
    expect(s.sending).toBe(false);
    expect(s.sendingBySessionId['sess-1']).toBe(false);
    const assistant = lastAssistant(store, 'sess-1');
    const step = assistant?.reasoning?.steps.find((x) => x.stepId === 'open-step');
    expect(step?.ok).toBe(false);
    expect(step?.error?.code).toBe('STREAM_DISCONNECTED');
    expect(step?.endTime).toBeGreaterThan(0);
    expect(fake.streamCount()).toBe(0);
    store.dispose();
  });

  test('非 StreamDisconnectedError 的 stream 异常被吞 → 不抛到业务侧', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    fake.failStream('sess-1', new Error('random boom'));
    await nextTick();
    // 不抛即通过；sending 不被该路径复位（非断连语义）
    expect(store.getState().sendingBySessionId['sess-1']).toBe(true);
    store.dispose();
  });

  test('turn 结束时 placeholder 未替换 → listMessages 兜底解析 id + turnId + commit reasoning', async () => {
    const reasoning = createMemoryReasoningStore();
    const fake = makeFakePort();
    const store = createAssistantStore({
      engine: fake.port,
      defaultAgentId: 'a',
      reasoningStore: reasoning,
    });
    await store.send('q');
    await nextTick();
    // 服务端落库后的真实 assistant 消息（兜底 listMessages 返回）
    fake.setMessages('sess-1', [
      { id: 'u-real', role: 'user', content: 'q', createTime: 1 },
      { id: 'srv-real', role: 'assistant', content: 'ans', createTime: 2, turnId: '1001' },
    ]);
    fake.pushEvent('sess-1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'r1', kind: 'phase', event: 'START', time: 1 },
    });
    fake.pushEvent('sess-1', {
      event: 'reasoning-delta-v1',
      data: { stepId: 'r1', text: 'late-bound reasoning' },
    });
    // 全程没有 message-delta（无 serverMessageId）→ placeholder 残留
    fake.pushEvent('sess-1', { event: 'turn-completed-v1', data: { turnId: '1001' } });
    await nextTick();
    await nextTick();
    expect(fake.calls.listMessages.length).toBeGreaterThanOrEqual(1);
    const assistant = lastAssistant(store, 'sess-1');
    expect(assistant?.id).toBe('srv-real');
    expect(assistant?.turnId).toBe('1001');
    // 兜底替换后 reasoning 以真实 id commit 到 store
    const persisted = await reasoning.get('sess-1', 'srv-real');
    expect(persisted?.tree.steps[0]?.text).toBe('late-bound reasoning');
    store.dispose();
  });

  test('fallbackResolveAssistantId=false → turn 结束不调用 listMessages，placeholder 保留', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({
      engine: fake.port,
      defaultAgentId: 'a',
      fallbackResolveAssistantId: false,
    });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', { event: 'turn-completed-v1', data: { turnId: '1001' } });
    await nextTick();
    await nextTick();
    expect(fake.calls.listMessages).toHaveLength(0);
    const assistant = lastAssistant(store, 'sess-1');
    expect(assistant?.id.startsWith('assistant-')).toBe(true);
    store.dispose();
  });

  test('placeholderIdPrefix 可定制：占位 id 用自定义前缀生成与替换', async () => {
    const fake = makeFakePort();
    const store = createAssistantStore({
      engine: fake.port,
      defaultAgentId: 'a',
      placeholderIdPrefix: 'ph-',
      fallbackResolveAssistantId: false,
    });
    await store.send('q');
    await nextTick();
    expect(lastAssistant(store, 'sess-1')?.id.startsWith('ph-')).toBe(true);
    fake.pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'x' } },
    });
    await nextTick();
    expect(lastAssistant(store, 'sess-1')?.id).toBe('srv-1');
    store.dispose();
  });

  test('reasoning commit 时 IDB put 抛错被吞 → 不影响 turn 终态', async () => {
    const failingStore = {
      get: async () => null,
      put: async () => {
        throw new Error('idb write failed');
      },
      bulkGet: async () => new Map(),
    };
    const fake = makeFakePort();
    const store = createAssistantStore({
      engine: fake.port,
      defaultAgentId: 'a',
      reasoningStore: failingStore,
    });
    await store.send('q');
    await nextTick();
    fake.pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'A' } },
    });
    fake.pushEvent('sess-1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'r', kind: 'phase', event: 'START', time: 1 },
    });
    fake.pushEvent('sess-1', {
      event: 'reasoning-delta-v1',
      data: { stepId: 'r', text: 'will fail to persist' },
    });
    fake.pushEvent('sess-1', { event: 'turn-completed-v1', data: { turnId: '1001' } });
    await nextTick();
    await nextTick();
    const s = store.getState();
    expect(s.lastTurnStatusBySessionId['sess-1']).toBe('completed');
    expect(s.sending).toBe(false);
    store.dispose();
  });

  test('openSession 时 bulkGet 抛错被吞 → 消息列表仍保持原始拉取结果', async () => {
    const failingStore = {
      get: async () => null,
      put: async () => {
        /* no-op */
      },
      bulkGet: async (): Promise<Map<string, never>> => {
        throw new Error('idb read failed');
      },
    };
    const fake = makeFakePort({
      sessions: [{ id: 's1', title: 't', updatedAt: 1 }],
      messages: {
        s1: [{ id: 'm1', role: 'assistant', content: 'hello', createTime: 1 }],
      },
    });
    const store = createAssistantStore({
      engine: fake.port,
      reasoningStore: failingStore,
    });
    await store.openSession('s1');
    await nextTick();
    // refreshMessages 整体 swallow：bulkGet 失败 → 该次回填放弃，不抛
    expect(store.getState().currentSessionId).toBe('s1');
    store.dispose();
  });
});

describe('AssistantStore — 多 session sending 同步', () => {
  test('切换 session 时 sending 跟随目标 session 的 sendingBySessionId', async () => {
    const fake = makeFakePort({
      sessions: [
        { id: 's1', title: 't1', updatedAt: 1 },
        { id: 's2', title: 't2', updatedAt: 2 },
      ],
    });
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.openSession('s1');
    await store.send('q-on-s1');
    await nextTick();
    expect(store.getState().sending).toBe(true);
    await store.openSession('s2'); // s2 空闲
    expect(store.getState().sending).toBe(false);
    expect(store.getState().sendingBySessionId['s1']).toBe(true);
    await store.openSession('s1'); // 切回仍在发送
    expect(store.getState().sending).toBe(true);
    store.dispose();
  });

  test('非当前 session 的 turn 完成不影响当前 session 的 sending', async () => {
    const fake = makeFakePort({
      sessions: [
        { id: 's1', title: 't1', updatedAt: 1 },
        { id: 's2', title: 't2', updatedAt: 2 },
      ],
    });
    const store = createAssistantStore({ engine: fake.port, defaultAgentId: 'a' });
    await store.openSession('s1');
    await store.send('q1');
    await store.openSession('s2');
    await store.send('q2');
    await nextTick();
    expect(store.getState().sending).toBe(true); // s2 sending
    fake.pushEvent('s1', { event: 'turn-completed-v1', data: { turnId: '1001' } });
    await nextTick();
    const s = store.getState();
    expect(s.sendingBySessionId['s1']).toBe(false);
    expect(s.sendingBySessionId['s2']).toBe(true);
    expect(s.sending).toBe(true); // 当前是 s2，不受 s1 影响
    store.dispose();
  });
});

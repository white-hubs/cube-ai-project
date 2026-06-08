import { describe, expect, test } from 'bun:test';
import { createAssistantStore, AssistantStore } from './store';
import { createMemoryReasoningStore } from './reasoning-store';
import { SessionBusyError, StoreDisposedError, StartTurnFailedError } from '@cube-ai/agent-sdk-client';
import type {
  AssistantEnginePort,
  GrantResponseInput,
  NormalizedSseEvent,
  PortMessageItem,
} from './port';
import type { AssistantSessionSummary } from './types';
import type { AssistantState } from './store';
import type { AssistantMessage } from './types';

interface FakeStream {
  push(ev: NormalizedSseEvent): void;
  end(): void;
  fail(err: Error): void;
}

/**
 * Build a controllable in-memory AssistantEnginePort for tests.
 * `pushEvent` resolves the next streamEvents iterator step;
 * `endStream` ends the iterator gracefully.
 */
function makeFakePort(initial: {
  sessions?: AssistantSessionSummary[];
  messages?: Record<string, PortMessageItem[]>;
} = {}): {
  port: AssistantEnginePort;
  pushEvent: (sessionId: string, ev: NormalizedSseEvent) => void;
  endStream: (sessionId: string) => void;
  failStream: (sessionId: string, e: Error) => void;
  calls: {
    startTurn: Array<{ sessionId: string; body: unknown }>;
    cancelTurn: Array<{ sessionId: string; turnId: string }>;
    listMessages: Array<{ sessionId: string }>;
    patchSession: Array<{ sessionId: string; patch: unknown }>;
    respondGrant: GrantResponseInput[];
    streamEvents: Array<{ sessionId: string; turnId: string | undefined }>;
  };
  streamCount: () => number;
} {
  const streams = new Map<string, FakeStream>();
  const turnCounter = { n: 1000 };
  const calls = {
    startTurn: [] as Array<{ sessionId: string; body: unknown }>,
    cancelTurn: [] as Array<{ sessionId: string; turnId: string }>,
    listMessages: [] as Array<{ sessionId: string }>,
    patchSession: [] as Array<{ sessionId: string; patch: unknown }>,
    respondGrant: [] as GrantResponseInput[],
    streamEvents: [] as Array<{ sessionId: string; turnId: string | undefined }>,
  };
  let sessions = initial.sessions ?? [];
  const messages = { ...(initial.messages ?? {}) };

  const port: AssistantEnginePort = {
    startTurn: async (sessionId, body) => {
      calls.startTurn.push({ sessionId, body });
      const turnId = String(++turnCounter.n);
      return { turnId };
    },
    streamEvents: (sessionId, opts) => {
      calls.streamEvents.push({ sessionId, turnId: opts?.turnId });
      const queue: NormalizedSseEvent[] = [];
      const resolvers: Array<(v: IteratorResult<NormalizedSseEvent>) => void> = [];
      let done = false;
      let failure: Error | null = null;
      const handle: FakeStream = {
        push(ev) {
          if (done) return;
          if (resolvers.length > 0) resolvers.shift()!({ value: ev, done: false });
          else queue.push(ev);
        },
        end() {
          if (done) return;
          done = true;
          while (resolvers.length > 0) {
            resolvers.shift()!({ value: undefined as unknown as NormalizedSseEvent, done: true });
          }
        },
        fail(err) {
          if (done) return;
          done = true;
          failure = err;
          while (resolvers.length > 0) {
            const r = resolvers.shift()!;
            // throw via custom mechanism: resolve with a sentinel then iterator next() will throw
            r({ value: undefined as unknown as NormalizedSseEvent, done: true });
          }
        },
      };
      streams.set(sessionId, handle);
      const aborted = (): boolean => opts?.signal?.aborted === true;
      const cleanup = (): void => {
        // 仅清除当前 handle（避免覆盖一个 session 上的新 stream）
        if (streams.get(sessionId) === handle) streams.delete(sessionId);
      };

      const iter: AsyncIterableIterator<NormalizedSseEvent> = {
        [Symbol.asyncIterator]() {
          return iter;
        },
        next(): Promise<IteratorResult<NormalizedSseEvent>> {
          if (failure) {
            const e = failure;
            failure = null;
            cleanup();
            return Promise.reject(e);
          }
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false });
          }
          if (done || aborted()) {
            cleanup();
            return Promise.resolve({ value: undefined as unknown as NormalizedSseEvent, done: true });
          }
          return new Promise((resolve) => {
            resolvers.push(resolve);
            opts?.signal?.addEventListener('abort', () => {
              const idx = resolvers.indexOf(resolve);
              if (idx >= 0) {
                resolvers.splice(idx, 1);
                cleanup();
                resolve({ value: undefined as unknown as NormalizedSseEvent, done: true });
              }
            }, { once: true });
          });
        },
        // for-await 中 `break` 触发 — 模拟 fetch reader.cancel() 释放
        return(): Promise<IteratorResult<NormalizedSseEvent>> {
          done = true;
          cleanup();
          return Promise.resolve({ value: undefined as unknown as NormalizedSseEvent, done: true });
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
    listSessions: async () => ({ items: sessions, hasMore: false }),
    getSession: async (id) => sessions.find((s) => s.id === id) ?? null,
    patchSession: async (sessionId, patch) => {
      calls.patchSession.push({ sessionId, patch });
      sessions = sessions.map((s) =>
        s.id === sessionId && typeof patch.title === 'string'
          ? { ...s, title: patch.title }
          : s,
      );
    },
    deleteSession: async () => {
      /* no-op */
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
    calls,
    streamCount: () => streams.size,
  };
}

function snapshot(store: AssistantStore): Readonly<AssistantState> {
  return store.getState();
}

async function nextTick(): Promise<void> {
  // 让微任务跑完
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

describe('AssistantStore — subscribe / snapshot', () => {
  test('emits state on subscribe and each setState', () => {
    const { port } = makeFakePort();
    const store = createAssistantStore({ engine: port });
    const states: AssistantState[] = [];
    const unsub = store.subscribe((s) => states.push({ ...s }));
    expect(states.length).toBe(1);
    expect(states[0]!.sessions).toEqual([]);
    unsub();
    store.dispose();
  });
});

describe('AssistantStore — send / streamEvents reducer', () => {
  test('send 自动 createSession + 注入 user + assistant placeholder + activeTurnId', async () => {
    const { port, calls } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'agent-1' });
    const { turnId } = await store.send('hello');
    expect(turnId).toBe('1001');
    const s = snapshot(store);
    expect(s.currentSessionId).toBe('sess-1');
    const msgs = s.messagesBySessionId['sess-1'] ?? [];
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[0]?.content).toBe('hello');
    expect(msgs[1]?.role).toBe('assistant');
    expect(msgs[1]?.content).toBe('');
    expect(s.sending).toBe(true);
    expect(s.activeTurnIdBySessionId['sess-1']).toBe('1001');
    expect(calls.startTurn[0]?.sessionId).toBe('sess-1');
    store.dispose();
  });

  test('send patches session title from first user message (not from title text)', async () => {
    const { port, calls } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'agent-1' });
    const sessionId = await store.createSession({
      agentId: 'agent-1',
      title: '新的对话',
    });
    await store.send('当前系统配置了哪些流程?');
    await nextTick();
    expect(calls.patchSession).toEqual([
      { sessionId, patch: { title: '当前系统配置了哪些流程?' } },
    ]);
    expect(snapshot(store).sessions.find((s) => s.id === sessionId)?.title).toBe(
      '当前系统配置了哪些流程?',
    );
    store.dispose();
  });

  test('send does not patch session title when session already has a user message', async () => {
    const sessionId = 'sess-existing';
    const { port, calls } = makeFakePort({
      sessions: [{ id: sessionId, title: '已有标题', updatedAt: 1 }],
      messages: {
        [sessionId]: [
          { id: 'u-1', role: 'user', content: '第一条', createTime: 1 },
          { id: 'a-1', role: 'assistant', content: '回复', createTime: 2 },
        ],
      },
    });
    const store = createAssistantStore({ engine: port, defaultAgentId: 'agent-1' });
    await store.openSession(sessionId);
    await store.send('第二条');
    await nextTick();
    expect(calls.patchSession).toEqual([]);
    store.dispose();
  });

  test('send forwards multimodal body with image_ref and attachments', async () => {
    const { port, calls } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'agent-1' });
    await store.send('compare', {
      attachments: [
        {
          attachmentId: 'att_01',
          kind: 'image',
          fileId: 'file_01',
          mimeType: 'image/png',
          previewUrl: '/v1/files/file_01/preview',
        },
      ],
    });
    const body = calls.startTurn[0]?.body as {
      content?: { blocks?: unknown[] };
      attachments?: unknown[];
    };
    expect(body.attachments).toHaveLength(1);
    expect(body.content?.blocks).toEqual(
      expect.arrayContaining([
        { type: 'text', text: 'compare' },
        { type: 'image_ref', attachmentId: 'att_01' },
      ]),
    );
    const msgs = snapshot(store).messagesBySessionId['sess-1'] ?? [];
    expect(msgs[0]?.attachments?.[0]?.fileId).toBe('file_01');
    store.dispose();
  });

  test('send forwards per-message runtimeRefs to engine.startTurn', async () => {
    const { port, calls } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'agent-1' });
    const runtimeRefs = {
      knowledgeBases: [{ kbId: 'kb-1', displayName: '产品知识库' }],
    };
    await store.send('hello', { runtimeRefs });
    const body = calls.startTurn[0]?.body as {
      runtimeRefs?: unknown;
    };
    expect(body.runtimeRefs).toEqual(runtimeRefs);
    store.dispose();
  });

  test('message-delta-v1 累加内容 + 把 placeholder id 替换为 serverMessageId', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('hi');
    await nextTick();
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', turnId: '1001', delta: { type: 'text', text: '你' } },
    });
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: '好' } },
    });
    await nextTick();
    const msgs: AssistantMessage[] = snapshot(store).messagesBySessionId['sess-1'] ?? [];
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant?.id).toBe('srv-1');
    expect(assistant?.content).toBe('你好');
    expect(assistant?.turnId).toBe('1001');
    store.dispose();
  });

  test('reasoning-step-v1 START + reasoning-delta-v1 累加进 assistant.reasoning', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'step-1', kind: 'phase', phase: 'planning', event: 'START', time: 1, label: 'plan' },
    });
    pushEvent('sess-1', {
      event: 'reasoning-delta-v1',
      data: { stepId: 'step-1', text: 'thinking...', seqInStep: 1 },
    });
    await nextTick();
    const assistant = (snapshot(store).messagesBySessionId['sess-1']! as AssistantMessage[])
      .find((m) => m.role === 'assistant');
    expect(assistant?.reasoning?.steps).toHaveLength(1);
    expect(assistant?.reasoning?.steps[0]?.text).toBe('thinking...');
    store.dispose();
  });

  test('tool-call-started/completed folds into assistant.reasoning as a child tool-call step', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'phase-1', kind: 'phase', phase: 'execution', event: 'START', time: 1, label: '执行中' },
    });
    pushEvent('sess-1', {
      event: 'tool-call-started-v1',
      data: {
        turnId: '1001',
        parentStepId: 'phase-1',
        toolCallId: 'tc_1',
        toolName: 'platform.search',
        args: { query: 'alarm' },
      },
    });
    pushEvent('sess-1', {
      event: 'tool-call-completed-v1',
      data: {
        turnId: '1001',
        parentStepId: 'phase-1',
        toolCallId: 'tc_1',
        toolName: 'platform.search',
        durationMs: 42,
        ok: true,
        output: { count: 1 },
      },
    });
    await nextTick();

    const s = snapshot(store);
    const assistant = (s.messagesBySessionId['sess-1']! as AssistantMessage[])
      .find((m) => m.role === 'assistant');
    expect(assistant?.reasoning?.steps).toHaveLength(2);
    expect(assistant?.reasoning?.steps[1]).toMatchObject({
      stepId: 'tool:tc_1',
      parentStepId: 'phase-1',
      kind: 'tool-call',
      toolCallId: 'tc_1',
      toolName: 'platform.search',
      ok: true,
      durationMs: 42,
    });
    expect(s.toolEventsBySessionId['sess-1']?.[0]).toMatchObject({
      id: 'tc_1',
      toolName: 'platform.search',
      phase: 'completed',
      resultPreview: { count: 1 },
      turnId: '1001',
    });
    store.dispose();
  });

  test('usage-delta-v2 updates current turn cumulative and replaces same attribution snapshot', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 10, output: 1, total: 11 },
        cumulative: { input: 10, output: 1, total: 11 },
        attribution: { id: 'llm-1', kind: 'llm_call', label: 'intent' },
        accuracy: 'estimated',
      },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 12, output: 2, total: 14 },
        cumulative: { input: 12, output: 2, total: 14 },
        attribution: { id: 'llm-1', kind: 'llm_call', label: 'intent' },
        accuracy: 'final',
      },
    });
    await nextTick();
    const usage = snapshot(store).tokenUsageBySessionId['sess-1'];
    expect(usage?.cumulative).toEqual({ input: 12, output: 2, total: 14 });
    expect(usage?.items).toHaveLength(1);
    expect(usage?.items[0]).toMatchObject({
      usage: { input: 12, output: 2, total: 14 },
      attribution: { id: 'llm-1', label: 'intent' },
      accuracy: 'final',
    });
    store.dispose();
  });

  test('usage-delta-v2 without attribution updates cumulative but does NOT push items[] (turn-aggregate fallback)', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 100, output: 20, total: 120 },
        cumulative: { input: 100, output: 20, total: 120 },
        attribution: { id: 'llm-1', kind: 'llm_call', label: 'intent' },
        accuracy: 'final',
      },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 8066, output: 385, total: 8451 },
        cumulative: { input: 8066, output: 385, total: 8451 },
      },
    });
    await nextTick();
    const usage = snapshot(store).tokenUsageBySessionId['sess-1'];
    expect(usage?.cumulative).toEqual({ input: 8066, output: 385, total: 8451 });
    expect(usage?.items).toHaveLength(1);
    expect(usage?.items[0]?.attribution?.id).toBe('llm-1');
    store.dispose();
  });

  test('turn-completed-v1 → sending=false, lastTurnStatus=completed, IDB commit', async () => {
    const reasoning = createMemoryReasoningStore();
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({
      engine: port,
      defaultAgentId: 'a',
      reasoningStore: reasoning,
    });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'A' } },
    });
    pushEvent('sess-1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'r', kind: 'phase', event: 'START', time: 1 },
    });
    pushEvent('sess-1', {
      event: 'reasoning-delta-v1',
      data: { stepId: 'r', text: 'reasoning' },
    });
    pushEvent('sess-1', {
      event: 'turn-completed-v1',
      data: { turnId: '1001' },
    });
    await nextTick();
    const s = snapshot(store);
    expect(s.sending).toBe(false);
    expect(s.lastTurnStatusBySessionId['sess-1']).toBe('completed');
    expect(s.activeTurnIdBySessionId['sess-1']).toBeNull();
    await nextTick();
    const persisted = await reasoning.get('sess-1', 'srv-1');
    expect(persisted?.tree.steps).toHaveLength(1);
    expect(persisted?.tree.steps[0]?.text).toBe('reasoning');
    store.dispose();
  });

  test('turn-completed-v1 → 把当前 turn 的 cumulative + items 写到 last assistant message.tokenUsage（terminalKind=completed）', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'A' } },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 1189, output: 39, total: 1228 },
        cumulative: { input: 1189, output: 39, total: 1228 },
        attribution: { id: 'llm-intent', kind: 'llm_call', label: 'intent', meta: { phase: 'intent' } },
        accuracy: 'final',
      },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 2491, output: 147, total: 2638 },
        cumulative: { input: 3680, output: 186, total: 3866 },
        attribution: { id: 'llm-tool-1', kind: 'llm_call', label: 'tool-use step 1', meta: { phase: 'execution' } },
        accuracy: 'final',
      },
    });
    pushEvent('sess-1', {
      event: 'turn-completed-v1',
      data: { turnId: '1001', tokenUsage: { input: 3680, output: 186, total: 3866 } },
    });
    await nextTick();
    const assistant = (snapshot(store).messagesBySessionId['sess-1']! as AssistantMessage[])
      .find((m) => m.role === 'assistant' && m.id === 'srv-1');
    expect(assistant?.tokenUsage?.cumulative).toEqual({ input: 3680, output: 186, total: 3866 });
    expect(assistant?.tokenUsage?.items).toHaveLength(2);
    expect(assistant?.tokenUsage?.items.map((i) => i.attribution?.id)).toEqual([
      'llm-intent',
      'llm-tool-1',
    ]);
    expect(assistant?.tokenUsage?.terminalKind).toBe('completed');
    store.dispose();
  });

  test('turn-completed-v1 → reasoningStore.put 收到 tokenUsage 参数（含 cumulative/items/terminalKind）', async () => {
    const reasoning = createMemoryReasoningStore();
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({
      engine: port,
      defaultAgentId: 'a',
      reasoningStore: reasoning,
    });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'A' } },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 100, output: 8, total: 108 },
        cumulative: { input: 100, output: 8, total: 108 },
        attribution: { id: 'llm-intent', kind: 'llm_call', label: 'intent' },
        accuracy: 'final',
      },
    });
    pushEvent('sess-1', {
      event: 'turn-completed-v1',
      data: { turnId: '1001', tokenUsage: { input: 100, output: 8, total: 108 } },
    });
    await nextTick();
    await nextTick();
    const persisted = await reasoning.get('sess-1', 'srv-1');
    expect(persisted?.tokenUsage?.cumulative).toEqual({ input: 100, output: 8, total: 108 });
    expect(persisted?.tokenUsage?.items).toHaveLength(1);
    expect(persisted?.tokenUsage?.terminalKind).toBe('completed');
    store.dispose();
  });

  test('turn-cancelled-v1 → 当时已知的 estimated items 也归档到 message.tokenUsage（terminalKind=cancelled）', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-1', delta: { type: 'text', text: 'A' } },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 500, output: 30, total: 530 },
        cumulative: { input: 500, output: 30, total: 530 },
        attribution: { id: 'llm-intent', kind: 'llm_call', label: 'intent' },
        accuracy: 'estimated',
      },
    });
    pushEvent('sess-1', {
      event: 'turn-cancelled-v1',
      data: { turnId: '1001' },
    });
    await nextTick();
    const assistant = (snapshot(store).messagesBySessionId['sess-1']! as AssistantMessage[])
      .find((m) => m.role === 'assistant' && m.id === 'srv-1');
    expect(assistant?.tokenUsage?.cumulative).toEqual({ input: 500, output: 30, total: 530 });
    expect(assistant?.tokenUsage?.items).toHaveLength(1);
    expect(assistant?.tokenUsage?.terminalKind).toBe('cancelled');
    store.dispose();
  });

  test('turn-failed-v1 → 把已积累的 token items 归档到 message.tokenUsage（terminalKind=failed）', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'message-delta-v1',
      data: { messageId: 'srv-2', delta: { type: 'text', text: 'A' } },
    });
    pushEvent('sess-1', {
      event: 'usage-delta-v2',
      data: {
        turnId: '1001',
        usage: { input: 200, output: 10, total: 210 },
        cumulative: { input: 200, output: 10, total: 210 },
        attribution: { id: 'llm-intent', kind: 'llm_call', label: 'intent' },
        accuracy: 'final',
      },
    });
    pushEvent('sess-1', {
      event: 'turn-failed-v1',
      data: { turnId: '1001', error: { code: 'UPSTREAM', message: 'llm-down' } },
    });
    await nextTick();
    const assistant = (snapshot(store).messagesBySessionId['sess-1']! as AssistantMessage[])
      .find((m) => m.role === 'assistant' && m.id === 'srv-2');
    expect(assistant?.tokenUsage?.cumulative).toEqual({ input: 200, output: 10, total: 210 });
    expect(assistant?.tokenUsage?.terminalKind).toBe('failed');
    store.dispose();
  });

  test('turn-failed-v1 → sending=false + 错误消息写入 assistant content', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'turn-failed-v1',
      data: { turnId: '1001', error: { code: 'UPSTREAM', message: 'llm-down' } },
    });
    await nextTick();
    const s = snapshot(store);
    expect(s.lastTurnStatusBySessionId['sess-1']).toBe('failed');
    expect(s.lastTurnFailureBySessionId['sess-1']?.message).toBe('llm-down');
    const assistant = (s.messagesBySessionId['sess-1']! as AssistantMessage[])
      .find((m) => m.role === 'assistant');
    expect(assistant?.content).toBe('llm-down');
    store.dispose();
  });

  test('openSession → 历史 assistant message 的 reasoning 与 tokenUsage 同步从 IDB 回填', async () => {
    const reasoning = createMemoryReasoningStore();
    await reasoning.put(
      'sess-1',
      'srv-history',
      {
        steps: [
          {
            stepId: 's1',
            kind: 'phase',
            label: '意图识别',
            phase: 'intent',
            startTime: 1,
            endTime: 100,
            ok: true,
            text: 'historical reasoning',
          },
        ],
      },
      {
        cumulative: { input: 1189, output: 39, total: 1228 },
        items: [],
        terminalKind: 'completed',
      },
    );
    const { port } = makeFakePort({
      sessions: [{ id: 'sess-1', title: 'old', updatedAt: 1 }],
      messages: {
        'sess-1': [
          {
            id: 'srv-history',
            role: 'assistant',
            content: 'archived reply',
            createTime: 1,
            turnId: '999',
          },
        ],
      },
    });
    const store = createAssistantStore({
      engine: port,
      defaultAgentId: 'a',
      reasoningStore: reasoning,
    });
    await store.openSession('sess-1');
    await nextTick();
    const msgs = (snapshot(store).messagesBySessionId['sess-1'] ?? []) as AssistantMessage[];
    const target = msgs.find((m) => m.id === 'srv-history');
    expect(target?.reasoning?.steps).toHaveLength(1);
    expect(target?.reasoning?.steps[0]?.text).toBe('historical reasoning');
    expect(target?.tokenUsage?.cumulative).toEqual({ input: 1189, output: 39, total: 1228 });
    expect(target?.tokenUsage?.terminalKind).toBe('completed');
    store.dispose();
  });

  test('openSession → IDB 无记录的历史 message 保持 reasoning/tokenUsage = undefined（不抛）', async () => {
    const { port } = makeFakePort({
      sessions: [{ id: 'sess-1', title: 'x', updatedAt: 1 }],
      messages: {
        'sess-1': [
          { id: 'srv-x', role: 'assistant', content: 'a', createTime: 1, turnId: '1' },
        ],
      },
    });
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.openSession('sess-1');
    await nextTick();
    const msgs = (snapshot(store).messagesBySessionId['sess-1'] ?? []) as AssistantMessage[];
    const target = msgs.find((m) => m.id === 'srv-x');
    expect(target?.reasoning).toBeUndefined();
    expect(target?.tokenUsage).toBeUndefined();
    store.dispose();
  });

  test('SessionBusyError throws locally when sending=true on same session', async () => {
    const { port } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('first');
    let err: unknown;
    try {
      await store.send('second');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(SessionBusyError);
    store.dispose();
  });

  test('send 失败时回滚两条 placeholder + sending=false', async () => {
    const { port } = makeFakePort();
    port.startTurn = async () => {
      throw new StartTurnFailedError('UPSTREAM', 500, 'fail', null, null, Date.now());
    };
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    let err: unknown;
    try {
      await store.send('hello');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StartTurnFailedError);
    const s = snapshot(store);
    expect(s.sending).toBe(false);
    expect(s.messagesBySessionId['sess-1'] ?? []).toEqual([]);
    store.dispose();
  });
});

describe('AssistantStore — cancel', () => {
  test('cancel → port.cancelTurn called + sending=false 立即', async () => {
    const { port, calls } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await store.cancel();
    expect(snapshot(store).sending).toBe(false);
    expect(calls.cancelTurn).toHaveLength(1);
    expect(calls.cancelTurn[0]?.sessionId).toBe('sess-1');
    expect(calls.cancelTurn[0]?.turnId).toBe('1001');
    store.dispose();
  });
});

describe('AssistantStore — grant', () => {
  test('grant-request-v1 push pendingGrants + awaitingGrant=true（sending 时）', async () => {
    const { port, pushEvent } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'grant-request-v1',
      data: {
        grantRequestId: 'gr-1',
        toolName: 't1',
        reason: 'why',
        scopeHint: 'ONCE',
      },
    });
    await nextTick();
    const s = snapshot(store);
    expect(s.pendingGrants).toHaveLength(1);
    expect(s.pendingGrants[0]?.grantRequestId).toBe('gr-1');
    expect(s.awaitingGrant).toBe(true);
    store.dispose();
  });

  test('respondGrant 移除 pendingGrant + 调 port.respondGrant', async () => {
    const { port, pushEvent, calls } = makeFakePort();
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.send('q');
    await nextTick();
    pushEvent('sess-1', {
      event: 'grant-request-v1',
      data: { grantRequestId: 'gr-1' },
    });
    await nextTick();
    await store.respondGrant({ grantRequestId: 'gr-1', decision: 'APPROVE' });
    const s = snapshot(store);
    expect(s.pendingGrants).toHaveLength(0);
    expect(calls.respondGrant).toHaveLength(1);
    expect(calls.respondGrant[0]?.decision).toBe('APPROVE');
    store.dispose();
  });
});

describe('AssistantStore — per-turn stream lifecycle (ADR-0008 §D5.1.v2)', () => {
  test('openSession 不开 stream；send 拿到 turnId 后才开；切换 session 不影响活跃 turn stream', async () => {
    const { port, calls, streamCount } = makeFakePort({
      sessions: [
        { id: 's1', title: 't1', updatedAt: 1 },
        { id: 's2', title: 't2', updatedAt: 2 },
      ],
    });
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.openSession('s1');
    await nextTick();
    expect(streamCount()).toBe(0); // 一 turn 一 stream — openSession 不开
    await store.send('hi-1');
    await nextTick();
    expect(streamCount()).toBe(1); // s1 的 turn 1001 stream
    await store.openSession('s2');
    await nextTick();
    expect(streamCount()).toBe(1); // 切 session 不开 stream — s2 还没 turn
    expect(calls.cancelTurn).toEqual([]); // 切 session 不取消 turn
    store.dispose();
  });

  test('turn-completed-v1 → per-turn stream 自然 break；streamCount 归 0', async () => {
    const { port, pushEvent, streamCount } = makeFakePort({
      sessions: [
        { id: 's1', title: 't1', updatedAt: 1 },
        { id: 's2', title: 't2', updatedAt: 2 },
      ],
    });
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.openSession('s1');
    await store.send('q-1');
    await store.openSession('s2');
    await nextTick();
    expect(streamCount()).toBe(1); // 仅 s1 1001 stream
    pushEvent('s1', { event: 'turn-completed-v1', data: { turnId: '1001' } });
    await nextTick();
    expect(streamCount()).toBe(0); // 本 turn 终态 → runTurnStream break → 注销
    store.dispose();
  });

  test('startTurnStream 把当前 turnId 透传给 engine.streamEvents(opts.turnId) — engine 侧 per-turn 过滤', async () => {
    const { port, calls } = makeFakePort({
      sessions: [{ id: 's1', title: 't1', updatedAt: 1 }],
    });
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.openSession('s1');
    const { turnId } = await store.send('q-1');
    await nextTick();
    expect(calls.streamEvents).toHaveLength(1);
    expect(calls.streamEvents[0]!.sessionId).toBe('s1');
    expect(calls.streamEvents[0]!.turnId).toBe(turnId);
    store.dispose();
  });

  test('跨 turn 事件防御性丢弃：上一 turn 的 reasoning-step 不会污染下一 turn placeholder', async () => {
    const { port, pushEvent } = makeFakePort({
      sessions: [{ id: 's1', title: 't1', updatedAt: 1 }],
    });
    const store = createAssistantStore({ engine: port, defaultAgentId: 'a' });
    await store.openSession('s1');
    const r1 = await store.send('q-1');
    await nextTick();
    pushEvent('s1', {
      event: 'reasoning-step-v1',
      data: { stepId: 'late', kind: 'phase', event: 'START', time: 1, turnId: '9999' },
    });
    await nextTick();
    // 当前 turn 是 r1.turnId（fixture turnCounter 起始 1000+1=1001），late 事件 turnId=9999 不匹配 → 丢
    expect(r1.turnId).toBe('1001');
    const msgs = (snapshot(store).messagesBySessionId['s1'] ?? []) as AssistantMessage[];
    const assistant = msgs.find((m) => m.role === 'assistant');
    expect(assistant?.reasoning?.steps ?? []).toHaveLength(0);
    store.dispose();
  });
});

describe('AssistantStore — dispose', () => {
  test('dispose 后再调用方法抛 StoreDisposedError', () => {
    const { port } = makeFakePort();
    const store = createAssistantStore({ engine: port });
    store.dispose();
    expect(() => store.reset()).toThrow(StoreDisposedError);
  });
});

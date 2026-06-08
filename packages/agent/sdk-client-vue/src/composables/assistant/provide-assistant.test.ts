/**
 * sdk-vue assistant composables smoke tests.
 *
 * 由于 sdk-assistant 已经覆盖了所有业务逻辑（44 tests），本文件只验证 Vue 适配层：
 *   - provideAssistant 注册的 instance 能被子组件 useAssistant 拿到
 *   - shallowReactive 上的 state 在 store.subscribe 推送时同步
 *   - slice composables 正确切片当前 state
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const registeredHappyDomForThisFile = typeof globalThis.document === 'undefined';
if (registeredHappyDomForThisFile) {
  GlobalRegistrator.register();
}
const { defineComponent, h, createApp, nextTick } = await import('vue');
const {
  provideAssistant,
  useAssistant,
  useAssistantSessions,
  useAssistantMessages,
} = await import('./index');
import type {
  AssistantEnginePort,
  NormalizedSseEvent,
} from '@cube-ai/agent-sdk-client-assistant';

afterAll(async () => {
  if (registeredHappyDomForThisFile) {
    await GlobalRegistrator.unregister();
  }
});

function makeStubPort(): AssistantEnginePort {
  return {
    startTurn: async () => ({ turnId: 'turn-1' }),
    streamEvents: async function* (): AsyncIterable<NormalizedSseEvent> {
      // pending stream — never yields
      await new Promise(() => {});
    },
    listMessages: async () => ({ items: [] }),
    createSession: async (req) => ({
      id: 'sess-stub-1',
      title: req.title ?? '',
      createTime: Date.now(),
    }),
    listSessions: async () => ({
      items: [{ id: 'sess-existing', title: 'existing', updatedAt: 1 }],
      hasMore: false,
    }),
    getSession: async () => null,
    patchSession: async () => {},
    deleteSession: async () => {},
    cancelTurn: async () => {},
    respondGrant: async () => {},
  };
}

/**
 * 构造一个根组件 + 一个子组件；根 setup 中 `provideAssistant`，
 * 子 setup 中 `runChildSetup()` 提供逻辑。返回 child setup 内 captured 的值。
 */
async function mountWithProvider<T>(
  port: AssistantEnginePort,
  runChildSetup: () => T,
): Promise<T> {
  let captured: T | undefined;
  const Child = defineComponent({
    setup() {
      captured = runChildSetup();
      return () => h('span');
    },
  });
  const Root = defineComponent({
    setup() {
      provideAssistant({ engine: port, defaultAgentId: 'a' });
      return () => h(Child);
    },
  });
  const app = createApp(Root);
  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  await nextTick();
  if (captured === undefined) throw new Error('child setup did not capture');
  return captured;
}

describe('provideAssistant / useAssistant', () => {
  test('child useAssistant returns the singleton provided in parent', async () => {
    const port = makeStubPort();
    const instance = await mountWithProvider(port, () => useAssistant());
    expect(instance.store).toBeDefined();
    expect(typeof instance.store.send).toBe('function');
  });

  test('useAssistantSessions sees sessions after createSession', async () => {
    const port = makeStubPort();
    const api = await mountWithProvider(port, () => useAssistantSessions());
    const id = await api.create({ title: 'hi' });
    await nextTick();
    expect(id).toBe('sess-stub-1');
    expect(api.sessions.value.length).toBeGreaterThan(0);
    expect(api.currentSessionId.value).toBe('sess-stub-1');
  });

  test('useAssistantMessages.send 触发 store.send + sending true', async () => {
    const port = makeStubPort();
    const api = await mountWithProvider(port, () => useAssistantMessages());
    const { turnId } = await api.send('hello');
    await nextTick();
    expect(turnId).toBe('turn-1');
    expect(api.sending.value).toBe(true);
    expect(api.messages.value.length).toBe(2);
  });

  /**
   * 业务侧（ghcloud assistant-chat.tsx）想在同一个组件 setup 内 `provideAssistant()`
   * + 立刻 `useAssistant*()`，避免强制拆 Provider/Body 两层。Vue 原生 `inject()`
   * 不看自身 provides；useAssistant 通过 getCurrentInstance().provides 兜底实现。
   */
  test('same-component provide + use 在同一个 setup 内可用（无 wrapper）', async () => {
    const port = makeStubPort();
    let capturedSessions: ReturnType<typeof useAssistantSessions> | undefined;
    let capturedInstance: ReturnType<typeof useAssistant> | undefined;
    const Comp = defineComponent({
      setup() {
        provideAssistant({ engine: port, defaultAgentId: 'a' });
        capturedInstance = useAssistant();
        capturedSessions = useAssistantSessions();
        return () => h('span');
      },
    });
    const app = createApp(Comp);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app.mount(host);
    await nextTick();
    expect(capturedInstance).toBeDefined();
    expect(typeof capturedInstance!.store.send).toBe('function');
    expect(capturedSessions).toBeDefined();
    expect(capturedSessions!.sessions.value.length).toBeGreaterThanOrEqual(0);
  });
});

/**
 * Agent core flow — provideAssistant + session + SSE turn.completed (ADR-0008 addendum).
 * Uses in-process stub port (no browser fetch); production path is engine `/v1/*`.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import type { AssistantEnginePort } from '@cube-ai/agent-sdk-client-assistant';

const registeredHappyDom = typeof globalThis.document === 'undefined';
if (registeredHappyDom) {
  GlobalRegistrator.register();
}

const { defineComponent, h, createApp, nextTick } = await import('vue');
const { provideAssistant, useAssistantSessions, useAssistantMessages } = await import(
  '@cube-ai/agent-sdk-client-vue'
);

afterAll(async () => {
  if (registeredHappyDom) {
    await GlobalRegistrator.unregister();
  }
});

function makeTurnCompletedPort(): AssistantEnginePort {
  const turnId = '1000000000000000001';
  return {
    startTurn: async () => ({ turnId }),
    streamEvents: async function* (): AsyncIterable<{
      event: string;
      data: Record<string, unknown>;
    }> {
      yield { event: 'turn-completed-v1', data: { turnId, finalMessageId: '1000000000000000002' } };
    },
    listMessages: async () => ({ items: [] }),
    createSession: async (req) => ({
      id: '1000000000000000003',
      title: req.title ?? '',
      createTime: Date.now(),
    }),
    listSessions: async () => ({
      items: [{ id: '1000000000000000003', title: 'loop4', updatedAt: Date.now() }],
      hasMore: false,
    }),
    getSession: async () => null,
    patchSession: async () => {},
    deleteSession: async () => {},
    cancelTurn: async () => {},
    respondGrant: async () => {},
  };
}

describe('ai-sdk-playground agent core flow', () => {
  test('provideAssistant → createSession → send → turn-completed-v1', async () => {
    const port = makeTurnCompletedPort();

    let sessionsApi: ReturnType<typeof useAssistantSessions> | undefined;
    let messagesApi: ReturnType<typeof useAssistantMessages> | undefined;

    const Root = defineComponent({
      setup() {
        provideAssistant({ engine: port, defaultAgentId: '8300000000000000001' });
        sessionsApi = useAssistantSessions();
        messagesApi = useAssistantMessages();
        return () => h('span');
      },
    });

    const app = createApp(Root);
    const host = document.createElement('div');
    document.body.appendChild(host);
    app.mount(host);
    await nextTick();

    const sessionId = await sessionsApi!.create({ title: 'loop4-core' });
    await nextTick();
    expect(sessionId).toBe('1000000000000000003');

    await messagesApi!.send('hello loop4');
    await nextTick();

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await nextTick();
      if (messagesApi!.lastTurnStatus.value === 'completed') break;
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(messagesApi!.lastTurnStatus.value).toBe('completed');
    expect(messagesApi!.sending.value).toBe(false);
  });
});

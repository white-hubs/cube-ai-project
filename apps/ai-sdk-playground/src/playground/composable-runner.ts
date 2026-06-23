import type { AssistantEnginePort } from '@cube-ai/agent-sdk-client-assistant';
import type { CapabilityEntry, InvokeResult } from './types';

function makeTurnCompletedPort(): AssistantEnginePort {
  const turnId = '1000000000000000001';
  return {
    startTurn: async () => ({ turnId }),
    streamEvents: async function* () {
      yield { event: 'turn-completed-v1', data: { turnId, finalMessageId: '1000000000000000002' } };
    },
    listMessages: async () => ({ items: [] }),
    createSession: async (req) => ({
      id: '1000000000000000003',
      title: req.title ?? '',
      createTime: Date.now(),
    }),
    listSessions: async () => ({
      items: [{ id: '1000000000000000003', title: 'playground', updatedAt: Date.now() }],
      hasMore: false,
    }),
    getSession: async () => null,
    patchSession: async () => {},
    deleteSession: async () => {},
    cancelTurn: async () => {},
    respondGrant: async () => {},
  };
}

async function mountVueRoot(setup: () => void): Promise<() => void> {
  const { defineComponent, h, createApp, nextTick } = await import('vue');
  const Root = defineComponent({
    setup: () => {
      setup();
      return () => h('span');
    },
  });
  const app = createApp(Root);
  const host = document.createElement('div');
  document.body.appendChild(host);
  app.mount(host);
  await nextTick();
  return () => {
    app.unmount();
    host.remove();
  };
}

async function waitForTurnComplete(
  messagesApi: { lastTurnStatus: { value: string } },
): Promise<void> {
  const { nextTick } = await import('vue');
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    await nextTick();
    if (messagesApi.lastTurnStatus.value === 'completed') return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

export async function runComposableCapability(
  cap: CapabilityEntry,
  args: Record<string, unknown>,
): Promise<InvokeResult> {
  try {
    if (cap.id === 'agent-sdk-client-vue.provideAssistant') {
      const { provideAssistant, useAssistantSessions, useAssistantMessages } = await import(
        '@cube-ai/agent-sdk-client-vue'
      );

      let sessionsApi: ReturnType<typeof useAssistantSessions> | undefined;
      let messagesApi: ReturnType<typeof useAssistantMessages> | undefined;

      const teardown = await mountVueRoot(() => {
        provideAssistant({
          engine: makeTurnCompletedPort(),
          defaultAgentId: String(args.defaultAgentId ?? '8300000000000000001'),
        });
        sessionsApi = useAssistantSessions();
        messagesApi = useAssistantMessages();
      });

      await sessionsApi!.create({ title: 'playground-composable' });
      await messagesApi!.send(String(args.message ?? 'hello'));
      await waitForTurnComplete(messagesApi!);

      const snapshot = {
        sessionId: sessionsApi!.currentSessionId.value,
        lastTurnStatus: messagesApi!.lastTurnStatus.value,
        sending: messagesApi!.sending.value,
      };
      teardown();
      return { ok: snapshot.lastTurnStatus === 'completed', kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-vue.useAssistantSessions') {
      const { provideAssistant, useAssistantSessions } = await import('@cube-ai/agent-sdk-client-vue');
      let sessionsApi: ReturnType<typeof useAssistantSessions> | undefined;
      const teardown = await mountVueRoot(() => {
        provideAssistant({ engine: makeTurnCompletedPort(), defaultAgentId: '8300000000000000001' });
        sessionsApi = useAssistantSessions();
      });
      await sessionsApi!.reload();
      const id = await sessionsApi!.create({ title: 'sessions-composable' });
      const snapshot = { createdId: id, count: sessionsApi!.sessions.value.length };
      teardown();
      return { ok: Boolean(id), kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-vue.useAssistantMessages') {
      const { provideAssistant, useAssistantSessions, useAssistantMessages } = await import(
        '@cube-ai/agent-sdk-client-vue'
      );
      let sessionsApi: ReturnType<typeof useAssistantSessions> | undefined;
      let messagesApi: ReturnType<typeof useAssistantMessages> | undefined;
      const teardown = await mountVueRoot(() => {
        provideAssistant({ engine: makeTurnCompletedPort(), defaultAgentId: '8300000000000000001' });
        sessionsApi = useAssistantSessions();
        messagesApi = useAssistantMessages();
      });
      await sessionsApi!.create({ title: 'msg-composable' });
      await messagesApi!.send(String(args.text ?? 'hello messages'));
      await waitForTurnComplete(messagesApi!);
      const snapshot = { lastTurnStatus: messagesApi!.lastTurnStatus.value };
      teardown();
      return { ok: snapshot.lastTurnStatus === 'completed', kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-vue.useAgenticClient') {
      const { provideAgenticClient, useAgenticClient } = await import('@cube-ai/agent-sdk-client-vue');
      let client: ReturnType<typeof useAgenticClient> | undefined;
      const teardown = await mountVueRoot(() => {
        provideAgenticClient({
          baseUrl: 'http://mock.test/agent',
          auth: { provider: () => 'token' },
          fetchImpl: ((() =>
            Response.json({ status: 'UP', timestamp: Date.now() })) as unknown) as typeof fetch,
        });
        client = useAgenticClient();
      });
      const health = await client!.healthLive();
      teardown();
      return { ok: health.status === 'UP', kind: 'composable', data: health };
    }

    if (cap.id === 'agent-sdk-client-vue.useSession') {
      const { provideAgenticClient, useSession } = await import('@cube-ai/agent-sdk-client-vue');
      let sessionApi: ReturnType<typeof useSession> | undefined;
      const sessionId = String(args.sessionId ?? '1000000000000000003');
      const teardown = await mountVueRoot(() => {
        const client = provideAgenticClient({
          baseUrl: 'http://mock.test/agent',
          auth: { provider: () => 'token' },
          fetchImpl: ((() =>
            Response.json({
              id: sessionId,
              title: 'session',
              status: 'ACTIVE',
              agentId: '8300000000000000001',
              userId: '1000000000000000002',
              createTime: Date.now(),
              updateTime: Date.now(),
            })) as unknown) as typeof fetch,
        });
        sessionApi = useSession(sessionId, client);
      });
      await sessionApi!.refetch();
      const snapshot = { session: sessionApi!.session.value, error: sessionApi!.error.value };
      teardown();
      return { ok: snapshot.session?.id === sessionId, kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-vue.useTools') {
      const { provideAgenticClient, useTools } = await import('@cube-ai/agent-sdk-client-vue');
      let toolsApi: ReturnType<typeof useTools> | undefined;
      const teardown = await mountVueRoot(() => {
        const client = provideAgenticClient({
          baseUrl: 'http://mock.test/agent',
          auth: { provider: () => 'token' },
          fetchImpl: ((() => Response.json({ items: [] })) as unknown) as typeof fetch,
        });
        toolsApi = useTools(client);
      });
      await toolsApi!.reload();
      const snapshot = { count: toolsApi!.descriptors.value.length };
      teardown();
      return { ok: true, kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-vue.useGrants') {
      const { provideAgenticClient, useGrants } = await import('@cube-ai/agent-sdk-client-vue');
      let grantsApi: ReturnType<typeof useGrants> | undefined;
      const teardown = await mountVueRoot(() => {
        const client = provideAgenticClient({
          baseUrl: 'http://mock.test/agent',
          auth: { provider: () => 'token' },
          fetchImpl: ((() => Response.json({ ok: true })) as unknown) as typeof fetch,
        });
        grantsApi = useGrants(client);
      });
      const snapshot = { pending: grantsApi!.pendingGrant.value };
      teardown();
      return { ok: true, kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-mock.startMockEngine') {
      const { startMockEngine } = await import('@cube-ai/agent-sdk-client-mock');
      const handle = await startMockEngine({
        scenarioName: String(args.scenarioName ?? 'health_up'),
      });
      const data = { url: handle.url, port: handle.port };
      await handle.stop();
      return { ok: true, kind: 'mock', data };
    }

    if (cap.id === 'agent-sdk-client-mock.triggerEvent') {
      const { startMockEngine } = await import('@cube-ai/agent-sdk-client-mock');
      const handle = await startMockEngine({ scenarioName: 'turn_streaming' });
      handle.triggerEvent(String(args.sessionId ?? '1000000000000000003'), {
        schema: 'turn-completed-v1',
        turnId: '1000000000000000001',
        finalMessageId: '1000000000000000002',
        tokenUsage: { input: 1, output: 1, total: 2 },
        durationMs: 1,
        endTime: Date.now(),
      });
      await handle.stop();
      return { ok: true, kind: 'mock', data: { triggered: true } };
    }

    if (cap.id === 'agent-sdk-client-vue.useHealthLive') {
      const { provideAgenticClient, useHealthLive } = await import('@cube-ai/agent-sdk-client-vue');
      let healthApi: ReturnType<typeof useHealthLive> | undefined;
      const teardown = await mountVueRoot(() => {
        provideAgenticClient({
          baseUrl: 'http://mock.test/agent',
          auth: { provider: () => 'token' },
          fetchImpl: ((() => Response.json({ status: 'UP', timestamp: Date.now() })) as unknown) as typeof fetch,
        });
        healthApi = useHealthLive();
      });
      await healthApi!.refresh();
      const snapshot = { status: healthApi!.status.value, error: healthApi!.error.value };
      teardown();
      return { ok: snapshot.status === 'UP', kind: 'composable', data: snapshot };
    }

    if (cap.id === 'agent-sdk-client-assistant.createAssistantStore') {
      const { createAssistantStore } = await import('@cube-ai/agent-sdk-client-assistant');
      const store = createAssistantStore({
        engine: makeTurnCompletedPort(),
        defaultAgentId: '8300000000000000001',
      });
      const sessionId = await store.createSession({ title: 'store-playground' });
      await store.send('hello store');
      const state = store.getState();
      store.dispose();
      return {
        ok: Boolean(sessionId),
        kind: 'composable',
        data: { sessionId, currentSessionId: state.currentSessionId },
      };
    }

    if (cap.id === 'agent-sdk-client-assistant.createAgenticEnginePort') {
      const { createAgenticEnginePort } = await import('@cube-ai/agent-sdk-client-assistant');
      const { createAgenticClient } = await import('@cube-ai/agent-sdk-client');
      const client = createAgenticClient({
        baseUrl: 'http://mock.test/agent',
        auth: { provider: () => 'token' },
        fetchImpl: ((() => Response.json({ items: [], page: { hasMore: false } })) as unknown) as typeof fetch,
      });
      const port = createAgenticEnginePort(client);
      const sessions = await port.listSessions();
      return { ok: Array.isArray(sessions.items), kind: 'composable', data: { count: sessions.items.length } };
    }

    return {
      ok: false,
      kind: cap.kind,
      error: `Composable runner not implemented for ${cap.id}`,
    };
  } catch (e) {
    return {
      ok: false,
      kind: cap.kind,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

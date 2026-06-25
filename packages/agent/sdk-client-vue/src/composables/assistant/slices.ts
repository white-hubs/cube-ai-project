/**
 * Sliced composables on top of `useAssistant()` (ADR-0008 §D6)。
 * 每个 hook 仅暴露 AssistantState 的一段切片；底层全部走同一 store snapshot
 * （`shallowReactive(state)` 中转，see `provide-assistant.ts`）。
 */
import { computed, type ComputedRef, type Ref } from 'vue';
import type { RuntimeRefs } from '@cube-ai/contracts';
import type {
  AssistantMessage,
  AssistantSessionSummary,
  GroupedSessions,
  LlmOption,
  PendingGrant,
  ReasoningTree,
  ToolEvent,
  TurnTokenUsage,
  TurnFailureSummary,
  TurnStatus,
} from '@cube-ai/agent-sdk-client-assistant';
import { groupSessionsByDate } from '@cube-ai/agent-sdk-client-assistant';
import { useAssistant } from './provide-assistant';

export interface UseAssistantSessionsReturn {
  sessions: ComputedRef<AssistantSessionSummary[]>;
  grouped: ComputedRef<GroupedSessions>;
  currentSessionId: ComputedRef<string | null>;
  loading: Readonly<Ref<boolean>>;
  reload: () => Promise<void>;
  open: (sessionId: string) => Promise<void>;
  create: (req: {
    agentId?: string;
    title?: string;
    modelCode?: string;
    purpose?: 'chat' | 'debug';
    agentVersionNo?: number;
    context?: Record<string, unknown>;
  }) => Promise<string>;
  remove: (sessionId: string) => Promise<void>;
  rename: (sessionId: string, title: string) => Promise<void>;
}

export function useAssistantSessions(): UseAssistantSessionsReturn {
  const { store, state, loadingSessions } = useAssistant();
  return {
    sessions: computed(() => state.sessions),
    grouped: computed(() => groupSessionsByDate(state.sessions)),
    currentSessionId: computed(() => state.currentSessionId),
    loading: loadingSessions,
    reload: () => store.loadSessions(),
    open: (id) => store.openSession(id),
    create: (req) => store.createSession(req),
    remove: (id) => store.deleteSession(id),
    rename: (id, title) => store.patchSession(id, { title }),
  };
}

export interface UseAssistantMessagesReturn {
  messages: ComputedRef<AssistantMessage[]>;
  sending: ComputedRef<boolean>;
  lastTurnStatus: ComputedRef<TurnStatus>;
  lastTurnFailure: ComputedRef<TurnFailureSummary | null>;
  send: (
    text: string,
    opts?: {
      modelCode?: string;
      providerCode?: string;
      providerId?: string;
      runtimeRefs?: RuntimeRefs;
    },
  ) => Promise<{ turnId: string }>;
  cancel: () => Promise<void>;
}

export function useAssistantMessages(): UseAssistantMessagesReturn {
  const { store, state } = useAssistant();
  return {
    messages: computed(() => {
      const id = state.currentSessionId;
      if (!id) return [];
      return state.messagesBySessionId[id] ?? [];
    }),
    sending: computed(() => state.sending),
    lastTurnStatus: computed<TurnStatus>(() => {
      const id = state.currentSessionId;
      if (!id) return 'idle';
      return state.lastTurnStatusBySessionId[id] ?? 'idle';
    }),
    lastTurnFailure: computed(() => {
      const id = state.currentSessionId;
      if (!id) return null;
      return state.lastTurnFailureBySessionId[id] ?? null;
    }),
    send: (text, opts) => store.send(text, opts),
    cancel: () => store.cancel(),
  };
}

export interface UseAssistantReasoningReturn {
  /** Reasoning tree of the last assistant message in the current session, or null. */
  lastReasoning: ComputedRef<ReasoningTree | null>;
}

export function useAssistantReasoning(): UseAssistantReasoningReturn {
  const { state } = useAssistant();
  return {
    lastReasoning: computed(() => {
      const id = state.currentSessionId;
      if (!id) return null;
      const msgs = state.messagesBySessionId[id] ?? [];
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m && m.role === 'assistant') return m.reasoning ?? null;
      }
      return null;
    }),
  };
}

export interface UseAssistantGrantsReturn {
  pendingGrants: ComputedRef<PendingGrant[]>;
  awaitingGrant: ComputedRef<boolean>;
  respondGrant: (input: {
    grantRequestId: string;
    decision: 'APPROVE' | 'DENY';
    scopeChoice?: 'ONCE' | 'SESSION' | 'PERSISTENT';
    rememberTtlSeconds?: number;
    note?: string;
  }) => Promise<void>;
}

export function useAssistantGrants(): UseAssistantGrantsReturn {
  const { store, state } = useAssistant();
  return {
    pendingGrants: computed(() => state.pendingGrants),
    awaitingGrant: computed(() => state.awaitingGrant),
    respondGrant: (input) => store.respondGrant(input),
  };
}

export interface UseAssistantToolsReturn {
  toolEvents: ComputedRef<ToolEvent[]>;
}

export function useAssistantTools(): UseAssistantToolsReturn {
  const { state } = useAssistant();
  return {
    toolEvents: computed(() => {
      const id = state.currentSessionId;
      if (!id) return [];
      return state.toolEventsBySessionId[id] ?? [];
    }),
  };
}

export interface UseAssistantTokenUsageReturn {
  tokenUsage: ComputedRef<TurnTokenUsage | null>;
}

export function useAssistantTokenUsage(): UseAssistantTokenUsageReturn {
  const { state } = useAssistant();
  return {
    tokenUsage: computed(() => {
      const id = state.currentSessionId;
      if (!id) return null;
      return state.tokenUsageBySessionId[id] ?? null;
    }),
  };
}

export interface UseAssistantDebugReturn {
  events: ComputedRef<
    Array<{ ts: number; event: string; data: Record<string, unknown> }>
  >;
}

export function useAssistantDebug(): UseAssistantDebugReturn {
  const { state } = useAssistant();
  return {
    events: computed(() => state.debugEvents),
  };
}

export interface UseAssistantLlmModelsReturn {
  models: Readonly<Ref<LlmOption[]>>;
  loading: Readonly<Ref<boolean>>;
}

export function useAssistantLlmModels(): UseAssistantLlmModelsReturn {
  const { models, loadingModels } = useAssistant();
  return {
    models,
    loading: loadingModels,
  };
}

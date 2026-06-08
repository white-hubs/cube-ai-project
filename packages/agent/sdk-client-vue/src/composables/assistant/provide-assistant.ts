/**
 * `provideAssistant` — Vue 应用层入口（ADR-0008 §D6）。
 *
 * 在根组件（或 router layout）中调用一次：
 *
 *   ```ts
 *   provideAssistant({
 *     engine: createAgenticEnginePort(agenticClient),
 *     defaultAgentId: '...',
 *     listModels: () => myCubeAiApi.listTenantModels(),
 *     reasoningStore: createIndexedDbReasoningStore({ dbName: 'ai-application-assistant-reasoning' }),
 *     autoLoad: 'sessions',
 *   });
 *   ```
 *
 * 子组件用 `useAssistant()` 或更细粒度切片（`useAssistantMessages` 等）拿响应式视图。
 *
 * 单例 scope：`InjectionKey`；同一应用 root 只允许一次 `provideAssistant`。
 */
import {
  getCurrentInstance,
  inject,
  onScopeDispose,
  provide,
  readonly,
  ref,
  shallowReactive,
  type App,
  type InjectionKey,
  type Ref,
} from 'vue';
import type {
  AssistantStore,
  AssistantStoreOptions,
  AssistantState,
  LlmOption,
  ReasoningStore,
} from '@cube-ai/agent-sdk-client-assistant';
import {
  createAssistantStore,
  createIndexedDbReasoningStore,
} from '@cube-ai/agent-sdk-client-assistant';

/** 缺省 IDB 库名（与 ghcloud 原 `assistant-reasoning-idb` 兼容；可被业务覆盖）。 */
export const DEFAULT_ASSISTANT_REASONING_DB_NAME = 'cube-ai-assistant-reasoning';

/**
 * 浏览器环境兜底：业务没传 `reasoningStore` 时自动用 IDB（dbName 见
 * `DEFAULT_ASSISTANT_REASONING_DB_NAME`）。SSR / Node 测试场景没有
 * `indexedDB` 全局 → 返回 `undefined`，由 `AssistantStore` 走 memory 兜底。
 */
function resolveDefaultReasoningStore(): ReasoningStore | undefined {
  if (typeof indexedDB === 'undefined') return undefined;
  return createIndexedDbReasoningStore({
    dbName: DEFAULT_ASSISTANT_REASONING_DB_NAME,
  });
}

export interface AssistantInstance {
  /** Underlying framework-agnostic store. */
  store: AssistantStore;
  /** Reactive snapshot — kept in sync via store.subscribe. */
  state: Readonly<AssistantState>;
  /** Convenient getter: same as `state.models`. */
  models: Readonly<Ref<LlmOption[]>>;
  /** 与 models 同理：slice composables 直接读 ref，避免仅依赖 shallowReactive 快照。 */
  loadingModels: Ref<boolean>;
  loadingSessions: Ref<boolean>;
}

export const ASSISTANT_INSTANCE_KEY: InjectionKey<AssistantInstance> = Symbol(
  '@cube-ai/agent-sdk-client-vue/AssistantInstance',
);

export interface ProvideAssistantOptions extends AssistantStoreOptions {
  /** 业务侧主动注入 `listModels` 时，`provideAssistant` 自动 fetch 一次。 */
  listModels?: () => Promise<LlmOption[]>;
}

/**
 * 在当前 Vue 组件 scope 内创建并 provide 单例 AssistantInstance。
 * 组件 scope dispose 时自动 dispose store。
 */
export function provideAssistant(
  opts: ProvideAssistantOptions,
): AssistantInstance {
  const instance = buildInstance(opts);
  provide(ASSISTANT_INSTANCE_KEY, instance);
  onScopeDispose(() => {
    instance.store.dispose();
  });
  return instance;
}

/**
 * 在 `app.use(VueRouter)` 一类 plugin 中提供（用 `app.provide`）。
 * 不绑定 scope；调用方负责在合适生命周期手动 `dispose`。
 */
export function installAssistant(
  app: App,
  opts: ProvideAssistantOptions,
): AssistantInstance {
  const instance = buildInstance(opts);
  app.provide(ASSISTANT_INSTANCE_KEY, instance);
  return instance;
}

function buildInstance(opts: ProvideAssistantOptions): AssistantInstance {
  // 浏览器环境 + 业务没传 reasoningStore → 自动接 IDB；
  // 这样刷新后 `refreshMessages` bulkGet 才能回填历史 reasoning。
  const reasoningStore =
    opts.reasoningStore ?? resolveDefaultReasoningStore();
  const store = createAssistantStore({
    ...opts,
    ...(reasoningStore ? { reasoningStore } : {}),
  });
  const state = shallowReactive({ ...store.getState() }) as AssistantState;
  const models = ref<LlmOption[]>(state.models);
  const loadingModels = ref(state.loadingModels);
  const loadingSessions = ref(state.loadingSessions);
  store.subscribe((next) => {
    Object.assign(state, next);
    models.value = next.models;
    loadingModels.value = next.loadingModels;
    loadingSessions.value = next.loadingSessions;
  });

  if (opts.listModels) {
    store.setLoadingModels(true);
    void opts
      .listModels()
      .then((next) => {
        // 必须走 store.setModels()：subscribe 回调里 `Object.assign(state, next)` 用的是
        // store 的内部 state 快照；如果只改 reactive `state.models`，任何后续 store 事件
        // （listSessions / openSession / send / ...）都会把它整盘清回 store 里残留的 `[]`。
        store.setModels(next);
      })
      .catch(() => {
        /* swallow — UI 自行展示空列表 */
      })
      .finally(() => {
        store.setLoadingModels(false);
      });
  }

  return {
    store,
    state: readonly(state) as Readonly<AssistantState>,
    models: readonly(models) as Readonly<Ref<LlmOption[]>>,
    loadingModels,
    loadingSessions,
  };
}

/**
 * Inject the singleton; throws when not provided yet.
 *
 * Vue `inject()` 默认只往父链回溯，不会看「当前组件自己 provide 的内容」。
 * 这里在标准 `inject()` 之外，额外尝试读取 `getCurrentInstance().provides`
 * （Vue 在首次 `provide()` 调用时会给本实例创建一份自己的 provides 表），
 * 这样业务侧可以在同一个组件 setup 内 `provideAssistant({...})` + 立刻
 * 调用 `useAssistantSessions()` 等切片，而**不**必为了 inject 强行拆出 Wrapper。
 */
export function useAssistant(): AssistantInstance {
  const self = getCurrentInstance();
  if (self) {
    const provides = (self as unknown as {
      provides?: Record<string | symbol, unknown>;
    }).provides;
    const own = provides
      ? (provides[ASSISTANT_INSTANCE_KEY as unknown as symbol] as AssistantInstance | undefined)
      : undefined;
    if (own) return own;
  }
  // 显式传 `null` 默认值，避免 Vue 在 fallback-到-self 路径时打印
  // "[Vue warn]: injection ... not found." 噪音。
  const fromParent = inject<AssistantInstance | null>(ASSISTANT_INSTANCE_KEY, null);
  if (fromParent) return fromParent;
  throw new Error(
    '[sdk-vue] useAssistant() called before provideAssistant() in this app scope',
  );
}

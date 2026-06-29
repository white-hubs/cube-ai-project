/**
 * Reasoning persistence interface + default implementations.
 * ADR-0008 §D4 / Q9.
 *
 *   - `ReasoningStore`：业务可注入的存储接口（`get` / `put` / `bulkGet`）。
 *   - `createMemoryReasoningStore()`：默认实现；进程内 Map；刷新 / 切租户后清空（SSR 安全）。
 *   - `createIndexedDbReasoningStore({ dbName, storeName? })`：浏览器实现；
 *     ghcloud 迁移时**必须**注入此 store 才能延续旧数据（dbName='ai-application-assistant-reasoning'）。
 */
import type { PersistedTokenUsage, ReasoningTree } from "../types";
import { hasVisibleReasoning } from "../utils/reasoning";

/**
 * 客户端 message 元数据持久化（v2 起同时承载 reasoning + tokenUsage）。
 *
 * 历史命名沿用 `ReasoningStore`：实际语义已扩展为「同一 message 的端到端
 * 推理副产物归档」。新增 `tokenUsage` 仅作为 put 的可选第 4 参；get/bulkGet
 * 返回结构由 `ReasoningTree | null` 升级为 `MessageMetaRow | null`。
 *
 * IDB schema：v1 行 `{ v: 1, tree }` → v2 行 `{ v: 2, tree, tokenUsage? }`；
 * 读旧行时 `tokenUsage` 字段为 undefined，调用方需做降级渲染。
 */
export interface MessageMetaRow {
  tree: ReasoningTree;
  tokenUsage?: PersistedTokenUsage;
}

export interface ReasoningStore {
  /** 取单条；不存在或不可读返回 null。 */
  get(sessionId: string, messageId: string): Promise<MessageMetaRow | null>;
  /**
   * 写入。空 reasoning + 空 tokenUsage 双空时 no-op，避免占库。
   * tokenUsage 可选；只写 reasoning 仍按 v2 行结构保存（兼容老调用方）。
   */
  put(sessionId: string, messageId: string, tree: ReasoningTree, tokenUsage?: PersistedTokenUsage): Promise<void>;
  /** 批量取（openSession 后回填）。实现可串行调用 `get`，但推荐独立优化。 */
  bulkGet(sessionId: string, messageIds: string[]): Promise<Map<string, MessageMetaRow>>;
}

/** 进程内 Map 实现；SSR 安全。 */
export function createMemoryReasoningStore(): ReasoningStore {
  const inner = new Map<string, MessageMetaRow>();
  const key = (s: string, m: string): string => `${s}::${m}`;
  return {
    async bulkGet(sessionId, messageIds) {
      const out = new Map<string, MessageMetaRow>();
      for (const mid of messageIds) {
        const v = inner.get(key(sessionId, mid));
        if (v) {
          out.set(mid, v);
        }
      }
      return out;
    },
    async get(sessionId, messageId) {
      return inner.get(key(sessionId, messageId)) ?? null;
    },
    async put(sessionId, messageId, tree, tokenUsage) {
      if (!hasVisibleReasoning(tree) && tokenUsage === undefined) {
        return;
      }
      const row: MessageMetaRow = {
        tree: structuredClone(tree),
        ...(tokenUsage !== undefined ? { tokenUsage: structuredClone(tokenUsage) } : {}),
      };
      inner.set(key(sessionId, messageId), row);
    },
  };
}

export interface IndexedDbReasoningStoreOptions {
  /** 必填：业务命名 (e.g. ghcloud='ai-application-assistant-reasoning')。 */
  dbName: string;
  /** 可选：默认 'reasoning'。 */
  storeName?: string;
  /** 可选：自定义 indexedDB factory（测试时注入 fake-indexeddb）。 */
  indexedDBFactory?: IDBFactory;
}

/**
 * IndexedDB 实现（浏览器）。SSR 环境下若无 indexedDB，会在每次方法调用时 no-op
 * （`get` 返回 null / `put` 静默 / `bulkGet` 返回空 Map），不抛错。
 */
export function createIndexedDbReasoningStore(options: IndexedDbReasoningStoreOptions): ReasoningStore {
  const dbName = options.dbName;
  const storeName = options.storeName ?? "reasoning";
  const factory = options.indexedDBFactory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);

  const openDb = (): Promise<IDBDatabase | null> => {
    if (!factory) {
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onerror = (): void => reject(req.error ?? new Error("idb_open_failed"));
      req.onupgradeneeded = (): void => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName);
        }
      };
      req.onsuccess = (): void => resolve(req.result);
    });
  };

  const makeKey = (sessionId: string, messageId: string): string => `${sessionId}::${messageId}`;

  const toPlain = (tree: ReasoningTree): ReasoningTree => JSON.parse(JSON.stringify(tree)) as ReasoningTree;

  const isReasoningTree = (value: unknown): value is ReasoningTree => {
    if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const steps = (value as { steps?: unknown }).steps;
    return Array.isArray(steps);
  };

  /**
   * 解析 IDB 行 → MessageMetaRow。兼容 v1 行（无 tokenUsage 字段）。
   * v 字段不再做严格断言：只要 `tree` 是合法 ReasoningTree 即视为有效行。
   */
  const parseRow = (raw: unknown): MessageMetaRow | null => {
    if (raw === null || raw === undefined || typeof raw !== "object") {
      return null;
    }
    const obj = raw as { tree?: unknown; tokenUsage?: unknown };
    if (!isReasoningTree(obj.tree)) {
      return null;
    }
    const out: MessageMetaRow = { tree: obj.tree };
    if (obj.tokenUsage !== null && obj.tokenUsage !== undefined && typeof obj.tokenUsage === "object") {
      out.tokenUsage = obj.tokenUsage as PersistedTokenUsage;
    }
    return out;
  };

  const toPlainTokenUsage = (u: PersistedTokenUsage): PersistedTokenUsage => JSON.parse(JSON.stringify(u)) as PersistedTokenUsage;

  return {
    async bulkGet(sessionId, messageIds) {
      const out = new Map<string, MessageMetaRow>();
      if (messageIds.length === 0) {
        return out;
      }
      const db = await openDb();
      if (!db) {
        return out;
      }
      try {
        await Promise.all(
          messageIds.map(
            (mid) =>
              new Promise<void>((resolve) => {
                const tx = db.transaction(storeName, "readonly");
                const r = tx.objectStore(storeName).get(makeKey(sessionId, mid));
                r.onerror = (): void => resolve();
                r.onsuccess = (): void => {
                  const row = parseRow(r.result);
                  if (row) {
                    out.set(mid, row);
                  }
                  resolve();
                };
              }),
          ),
        );
      } finally {
        db.close();
      }
      return out;
    },
    async get(sessionId, messageId) {
      const db = await openDb();
      if (!db) {
        return null;
      }
      try {
        return await new Promise<MessageMetaRow | null>((resolve, reject) => {
          const tx = db.transaction(storeName, "readonly");
          const r = tx.objectStore(storeName).get(makeKey(sessionId, messageId));
          r.onerror = (): void => reject(r.error ?? new Error("idb_get_failed"));
          r.onsuccess = (): void => resolve(parseRow(r.result));
        });
      } finally {
        db.close();
      }
    },
    async put(sessionId, messageId, tree, tokenUsage) {
      if (!hasVisibleReasoning(tree) && tokenUsage === undefined) {
        return;
      }
      const db = await openDb();
      if (!db) {
        return;
      }
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const row: { v: 2; tree: ReasoningTree; tokenUsage?: PersistedTokenUsage } = {
            v: 2,
            tree: toPlain(tree),
            ...(tokenUsage !== undefined ? { tokenUsage: toPlainTokenUsage(tokenUsage) } : {}),
          };
          store.put(row, makeKey(sessionId, messageId));
          tx.oncomplete = (): void => resolve();
          tx.onerror = (): void => reject(tx.error ?? new Error("idb_put_failed"));
          tx.onabort = (): void => reject(tx.error ?? new Error("idb_put_aborted"));
        });
      } finally {
        db.close();
      }
    },
  };
}

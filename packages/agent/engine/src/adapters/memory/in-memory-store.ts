// 实装 @tachu/core MemorySystem Port — 纯进程内 L1 实现
// ref: docs/detailed-design/03-core-adapters/memory.md §3.1 / §5.1
import type { AdapterCallContext, ContextWindow, MemoryEntry, MemorySystem } from "@tachu/core";
import { DEFAULT_ADAPTER_CALL_CONTEXT } from "@tachu/core";

/**
 * In-process (L1) MemorySystem backed by a plain Map.
 *
 * 用于：
 * 1. 独立使用（无 Redis 环境）
 * 2. 作为 RedisMemoryStore 的 L1 层
 *
 * 特性：
 * - load()   → 返回已存 ContextWindow 或空 window（entries=[], tokenCount=0）
 * - append() → 追加条目并更新 tokenCount 估算
 * - clear()  → 删除 session 数据
 * - 其他方法 → 最小实现（compress/archive no-op）
 *
 * ref: docs/detailed-design/03-core-adapters/memory.md §5 缓存策略
 */
export class InMemoryStore implements MemorySystem {
  private readonly windows = new Map<string, ContextWindow>();

  /**
   * B2：键去 tenant —— 同一 sessionId 命中同一记忆空间，隔离改由「全局唯一
   * sessionId + turn-start 归属门禁」承担（见 handoff）。ctx 仍可携 tenant 供别处
   * 使用，但不参与键。
   */
  private key(sessionId: string): string {
    return sessionId;
  }

  async load(sessionId: string, _ctx: AdapterCallContext): Promise<ContextWindow> {
    return (
      this.windows.get(this.key(sessionId)) ?? {
        entries: [],
        tokenCount: 0,
        limit: 128_000,
      }
    );
  }

  async loadFull(sessionId: string): Promise<MemoryEntry[]> {
    const window = await this.load(sessionId, DEFAULT_ADAPTER_CALL_CONTEXT);
    return [...window.entries];
  }

  async append(sessionId: string, entry: MemoryEntry, ctx: AdapterCallContext): Promise<void> {
    const existing = await this.load(sessionId, ctx);
    const stored: MemoryEntry = entry.id ? entry : { ...entry, id: `${entry.timestamp}-${existing.entries.length}` };
    const updated: ContextWindow = {
      entries: [...existing.entries, stored],
      tokenCount: existing.tokenCount + estimateTokens(stored),
      limit: existing.limit,
    };
    this.windows.set(this.key(sessionId), updated);
  }

  async compress(_sessionId: string): Promise<void> {
    /* M1.D：LLM 摘要压缩由 Session worker 触发；L1 InMemory 保持 no-op */
  }

  async recall(_sessionId: string, _query: string, _topK?: number): Promise<MemoryEntry[]> {
    /* 语义召回走 memory.recall Tool + VectorStore.hybridSearch（非本 L1 适配器职责） */
    return [];
  }

  async archive(_sessionId: string): Promise<void> {
    /* 归档写盘 / Outbox：M1.D */
  }

  async getSize(sessionId: string): Promise<{ entries: number; tokens: number }> {
    // B2: 键去前缀后必须**精确匹配** sessionId（旧 endsWith(':'+sessionId) 会静默失配）。
    const window = this.windows.get(this.key(sessionId));
    return {
      entries: window?.entries.length ?? 0,
      tokens: window?.tokenCount ?? 0,
    };
  }

  async trim(sessionId: string, options?: { keepHead?: number; keepTail?: number }): Promise<void> {
    const mapKey = this.key(sessionId);
    const window = this.windows.get(mapKey);
    if (!window || window.entries.length === 0) return;

    const head = options?.keepHead ?? 0;
    const tail = options?.keepTail ?? window.entries.length;
    const headEntries = window.entries.slice(0, head);
    const tailEntries = tail > 0 ? window.entries.slice(-tail) : [];

    const kept = [...headEntries, ...tailEntries];
    const deduped = [...new Map(kept.map((e, i) => [i, e])).values()];

    const updated: ContextWindow = {
      entries: deduped,
      tokenCount: deduped.reduce((acc, e) => acc + estimateTokens(e), 0),
      limit: window.limit,
    };
    this.windows.set(mapKey, updated);
  }

  async clear(sessionId: string): Promise<void> {
    // B2: 精确删除，避免误删「以同名 sessionId 结尾」的其它键。
    this.windows.delete(this.key(sessionId));
  }

  /** Expose for testing */
  getWindowCountForTest(): number {
    return this.windows.size;
  }
}

/**
 * Rough token estimate: 4 chars ≈ 1 token.
 * provider.md §6.2 OQ-LP-2 strategy.
 */
function estimateTokens(entry: MemoryEntry): number {
  const content = typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content);
  return Math.ceil(content.length / 4);
}

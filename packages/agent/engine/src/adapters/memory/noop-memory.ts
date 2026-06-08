import type {
  AdapterCallContext,
  ContextWindow,
  MemoryEntry,
  MemorySystem,
} from '@tachu/core';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';

/**
 * Skeleton NoOp `MemorySystem`. Every session resolves to an empty window.
 *
 * Rationale (03-core-adapters/README.md, Phase 0a scope): M1.C lands
 * `InMemoryMemorySystem` backed by MySQL `agentic_engine_sessions` +
 * `agentic_engine_messages` (regulation §3/§4); Phase 0a only needs the Port
 * to be resolvable so the Assembler typechecks.
 */
export class NoopMemoryStoreAdapter implements MemorySystem {
  private readonly windows = new Map<string, ContextWindow>();

  async load(sessionId: string, _ctx: AdapterCallContext): Promise<ContextWindow> {
    return this.windows.get(sessionId) ?? {
      entries: [],
      tokenCount: 0,
      limit: 128_000,
    };
  }

  async loadFull(sessionId: string): Promise<MemoryEntry[]> {
    const window = await this.load(sessionId, DEFAULT_ADAPTER_CALL_CONTEXT);
    return [...window.entries];
  }

  async append(sessionId: string, entry: MemoryEntry, ctx: AdapterCallContext): Promise<void> {
    const existing = await this.load(sessionId, ctx);
    existing.entries.push(entry);
    this.windows.set(sessionId, existing);
  }

  async compress(_sessionId: string): Promise<void> {
    // No-op: compression strategies land in M1.C with H-M-T summariser.
  }

  async recall(
    _sessionId: string,
    _query: string,
    _topK?: number,
  ): Promise<MemoryEntry[]> {
    return [];
  }

  async archive(_sessionId: string): Promise<void> {
    // No-op: archive lands with the outbox-backed snapshot writer.
  }

  async getSize(sessionId: string): Promise<{ entries: number; tokens: number }> {
    const window = await this.load(sessionId, DEFAULT_ADAPTER_CALL_CONTEXT);
    return { entries: window.entries.length, tokens: window.tokenCount };
  }

  async trim(
    _sessionId: string,
    _options?: { keepHead?: number; keepTail?: number },
  ): Promise<void> {
    // No-op for Phase 0a.
  }

  async clear(sessionId: string): Promise<void> {
    this.windows.delete(sessionId);
  }
}

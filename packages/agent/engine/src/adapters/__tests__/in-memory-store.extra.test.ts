/**
 * InMemoryStore — 多会话隔离与读写路径（P3-13 §5）
 */
import { describe, it, expect } from 'bun:test';
import { DEFAULT_ADAPTER_CALL_CONTEXT } from '@tachu/core';
import { InMemoryStore } from '../memory/in-memory-store';
import type { MemoryEntry } from '@tachu/core';

const CTX = DEFAULT_ADAPTER_CALL_CONTEXT;

const makeEntry = (content: string): MemoryEntry => ({
  id: `mem-${content}-${Date.now()}`,
  role: 'user',
  content,
  timestamp: Date.now(),
  anchored: false,
});

describe('InMemoryStore (Phase 3)', () => {
  it('read：空会话返回空 ContextWindow', async () => {
    const s = new InMemoryStore();
    const w = await s.load('unknown', CTX);
    expect(w.entries).toEqual([]);
    expect(w.tokenCount).toBe(0);
  });

  it('append + read：消息顺序保持追加顺序', async () => {
    const s = new InMemoryStore();
    await s.append('s1', makeEntry('a'), CTX);
    await s.append('s1', makeEntry('b'), CTX);
    const w = await s.load('s1', CTX);
    expect(w.entries.map((e) => e.content)).toEqual(['a', 'b']);
  });

  it('clear：清除指定 session，不影响其它 session', async () => {
    const s = new InMemoryStore();
    await s.append('a', makeEntry('1'), CTX);
    await s.append('b', makeEntry('2'), CTX);
    await s.clear('a');
    expect((await s.load('a', CTX)).entries).toEqual([]);
    expect((await s.load('b', CTX)).entries).toHaveLength(1);
  });

  it('multi-session：键空间隔离', async () => {
    const s = new InMemoryStore();
    await s.append('tenant-a', makeEntry('x'), CTX);
    await s.append('tenant-b', makeEntry('y'), CTX);
    const wa = await s.load('tenant-a', CTX);
    const wb = await s.load('tenant-b', CTX);
    expect(wa.entries[0]!.content).toBe('x');
    expect(wb.entries[0]!.content).toBe('y');
  });
});

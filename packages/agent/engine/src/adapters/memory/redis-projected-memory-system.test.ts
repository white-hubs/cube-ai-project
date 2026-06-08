import { describe, expect, it, beforeEach } from 'bun:test';
import type Redis from 'ioredis';
import type { AdapterCallContext, MemoryEntry } from '@tachu/core';
import { RedisMemoryStore } from './redis-memory-store';
import { MysqlProjectionOutbox } from './mysql-projection-outbox';
import { RedisProjectedMemorySystem } from './redis-projected-memory-system';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

const CTX: AdapterCallContext = {
  tenant: 1,
  correlation: {
    traceId: 't',
    requestId: 't',
    sessionId: 'sess-1',
    turnId: 't',
  },
};

function idleRedisStub(): Redis {
  const store = new Map<string, string[]>();
  const pipeline = () => {
    let key = '';
    const chain = {
      lpush(k: string, v: string) {
        key = k;
        const arr = store.get(k) ?? [];
        arr.unshift(v);
        store.set(k, arr);
        return chain;
      },
      ltrim() {
        return chain;
      },
      expire() {
        return chain;
      },
      del(k: string) {
        store.delete(k);
        return chain;
      },
      exec: async () => [],
    };
    return chain;
  };
  return {
    status: 'ready',
    connect: async () => {},
    lrange: async (key: string) => [...(store.get(key) ?? [])],
    pipeline,
    del: async (key: string) => {
      store.delete(key);
      return 1;
    },
    quit: async () => {},
  } as unknown as Redis;
}

type Row = Record<string, unknown>;

function createMemoryPool(): Pool & { _rows: Row[]; _nextId: () => bigint } {
  const rows: Row[] = [];
  let idSeq = 1n;
  const pool = {
    async query<T extends RowDataPacket[] | ResultSetHeader>(
      sql: string,
      params?: unknown[],
    ): Promise<[T, unknown]> {
      const p = params ?? [];
      if (sql.includes('INSERT INTO memory_projection_outbox')) {
        rows.push({
          id: p[0],
          tenant: p[1],
          session_id: p[2],
          ref: p[3],
          state: 'pending',
          attempts: 0,
          deleted: 0,
          create_time: p[5] ?? new Date(),
          update_time: p[7] ?? new Date(),
        });
        return [{ affectedRows: 1 } as ResultSetHeader, undefined] as [T, unknown];
      }
      if (sql.includes('SELECT ref, state') && sql.includes('LIMIT 1')) {
        const hit = rows.find(
          (r) =>
            r['tenant'] === p[0] &&
            r['session_id'] === p[1] &&
            r['ref'] === p[2] &&
            r['deleted'] === 0,
        );
        return [(hit ? [hit] : []) as T, undefined];
      }
      if (sql.includes('ORDER BY create_time ASC')) {
        return [
          rows.filter(
            (r) =>
              r['tenant'] === p[0] && r['session_id'] === p[1] && r['deleted'] === 0,
          ) as T,
          undefined,
        ];
      }
      return [{ affectedRows: 0 } as ResultSetHeader, undefined] as [T, unknown];
    },
  } as unknown as Pool;
  return Object.assign(pool, { _rows: rows, _nextId: () => idSeq++ });
}

describe('RedisProjectedMemorySystem', () => {
  let memory: RedisProjectedMemorySystem;
  let outbox: MysqlProjectionOutbox;

  beforeEach(() => {
    const store = new RedisMemoryStore({
      redisUrl: 'redis://localhost:6379',
      redisFactory: () => idleRedisStub(),
      tenantId: 1,
    });
    const pool = createMemoryPool();
    outbox = new MysqlProjectionOutbox({ pool, tenantId: 1, nextId: () => pool._nextId() });
    memory = new RedisProjectedMemorySystem({
      store,
      outbox,
      projectionProject: async () => [],
    });
  });

  it('delegates load/append to RedisMemoryStore', async () => {
    const entry: MemoryEntry = {
      id: 'e1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
      anchored: false,
    };
    await memory.append('sess-1', entry, CTX);
    const window = await memory.load('sess-1', CTX);
    expect(window.entries).toHaveLength(1);
    expect(window.entries[0]!.id).toBe('e1');
  });

  it('archive enqueues pending refs in MySQL outbox', async () => {
    await memory.append(
      'sess-1',
      {
        id: 'ref-a',
        role: 'assistant',
        content: 'answer',
        timestamp: 1,
        anchored: false,
      },
      CTX,
    );
    await memory.archive('sess-1');
    const pending = await outbox.listPending('sess-1');
    expect(pending.map((p) => p.ref)).toEqual(['ref-a']);
  });

  it('archive fails closed without projectionProject', async () => {
    const store = new RedisMemoryStore({
      redisUrl: 'redis://localhost:6379',
      redisFactory: () => idleRedisStub(),
    });
    const bare = new RedisProjectedMemorySystem({ store, outbox });
    await expect(bare.archive('sess-1')).rejects.toThrow(/projectionProject/);
  });
});

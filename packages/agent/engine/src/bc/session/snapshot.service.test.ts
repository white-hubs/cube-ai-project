import { describe, test, expect, mock } from 'bun:test';
import { SnapshotDecision } from './snapshot-decision';
import { SnapshotService } from './snapshot.service';
import type { Pool } from 'mysql2/promise';
import type { TurnRepository } from './turn.repository';

/**
 * Unit tests for SnapshotService.
 * ref: P3-05 §5 · snapshot-binding.md §5
 */

const SESSION_ID = '281474976710656';
const TENANT = 1;
const TURN_ID = '281474976710657';

function makePool(stub: { row: unknown } | null): Pool {
  return {
    execute: mock(async () => [[], []]) as unknown as Pool['execute'],
  } as Pool;
}

function makePoolWithRow(
  row: { agent_snapshot_json: string; user_principal_snapshot_json: string } | null,
): Pool {
  const fn = mock(async (sql: string) => {
    if (String(sql).includes('FROM sessions') && row) {
      return [[row], []] as never;
    }
    return [[], []] as never;
  });
  return { execute: fn } as unknown as Pool;
}

function makeTurns(stub: { getTurnRow: ReturnType<typeof mock> }): TurnRepository {
  return { getTurnRow: stub.getTurnRow } as unknown as TurnRepository;
}

const decision = new SnapshotDecision();

describe('SnapshotService.getLatestSnapshot', () => {
  test('returns null when MySQL pool not configured', async () => {
    const turns = makeTurns({
      getTurnRow: mock(async () => null),
    });
    const svc = new SnapshotService(decision, null, turns);
    const result = await svc.getLatestSnapshot(SESSION_ID, TENANT);
    expect(result).toBeNull();
  });

  test('returns snapshot rows when pool returns session', async () => {
    const pool = makePoolWithRow({
      agent_snapshot_json: JSON.stringify({ schema: 'agent-snapshot-v1' }),
      user_principal_snapshot_json: JSON.stringify({ schema: 'user-principal-v1' }),
    });
    const turns = makeTurns({ getTurnRow: mock(async () => null) });
    const svc = new SnapshotService(decision, pool, turns);
    const result = await svc.getLatestSnapshot(SESSION_ID, TENANT);
    expect(result).not.toBeNull();
    expect(result?.sessionId).toBe(SESSION_ID);
    expect(result?.loadedAtMs).toBeGreaterThan(0);
  });
});

describe('SnapshotService.bindSnapshot / getSnapshot', () => {
  test('bindSnapshot delegates to TurnRepository.updatePipelineSnapshotBinding', async () => {
    const upd = mock(async () => {});
    const turns = {
      requirePool: () => {},
      updatePipelineSnapshotBinding: upd,
      getTurnRow: mock(async () => ({
        sessionId: SESSION_ID,
        status: 'RUNNING',
        pipelineTrace: { snapshotBinding: { ok: true } },
      })),
    } as unknown as TurnRepository;
    const svc = new SnapshotService(decision, makePool(null), turns);
    await svc.bindSnapshot(TURN_ID, TENANT, { toolRefs: ['a'] });
    expect(upd.mock.calls.length).toBe(1);
    const triple = upd.mock.calls[0] as unknown as [string, number, unknown];
    expect(triple[2]).toEqual({ toolRefs: ['a'] });
  });

  test('getSnapshot reads snapshotBinding from pipeline_trace payload', async () => {
    const binding = { descriptors: ['x'] };
    const turns = {
      requirePool: () => {},
      updatePipelineSnapshotBinding: mock(async () => {}),
      getTurnRow: mock(async () => ({
        sessionId: SESSION_ID,
        status: 'RUNNING',
        pipelineTrace: { snapshotBinding: binding },
      })),
    } as unknown as TurnRepository;
    const svc = new SnapshotService(decision, makePool(null), turns);
    const got = await svc.getSnapshot(TURN_ID, TENANT);
    expect(got).toEqual(binding);
  });
});

describe('SnapshotService.decideStorage', () => {
  test('small payload ≤ 2KB → inline', () => {
    const turns = makeTurns({ getTurnRow: mock(async () => null) });
    const svc = new SnapshotService(decision, null, turns);
    expect(svc.decideStorage({ hello: 'world' })).toBe('inline');
  });

  test('large payload > 2KB → external', () => {
    const turns = makeTurns({ getTurnRow: mock(async () => null) });
    const svc = new SnapshotService(decision, null, turns);
    const big = { data: 'x'.repeat(3000) };
    expect(svc.decideStorage(big)).toBe('external');
  });
});

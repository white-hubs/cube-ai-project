/**
 * P4 Wave 4-A · T14 — Multi-replica engine smoke + Outbox leader exclusivity.
 *
 * Boots 3 engine subprocesses sharing one MySQL/Redis backplane (each with a
 * unique `INSTANCE_ID` and `AGENTIC_OUTBOX_LEADER_IN_TEST=1`). When
 * `enableOutboxRelay` is set, `engine/src/main.ts` starts
 * {@link OutboxRelayService} after listen so the shared
 * `agentic:engine:outbox:leader` key is owned by exactly one replica.
 *
 * Coverage:
 *   - Health / uniqueness smoke
 *   - `LeaderElection` SETNX + handover with per-replica ioredis clients (same
 *     primitives as the live relay)
 *   - SIGTERM on the process holding the live relay lock → another replica
 *     becomes leader (graceful `relay.stop()` releases Redis; followers probe)
 *
 * Deferred `it.skip`: BullMQ cross-replica jobId de-dup, 10k outbox throughput.
 *
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/multi-replica-jobs.testcontainers.test.ts
 *   bun run test:containers
 */
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { join } from 'node:path';
import Redis from 'ioredis';
import {
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMultiEngineStack,
  stopTrackedTestcontainersIfAny,
  type MultiEngineStack,
  resolveMonorepoRootFromImporter,
} from '@cube-ai/test-infra';
import {
  DEFAULT_LEADER_KEY,
  LeaderElection,
  createLeaderElectionRedis,
  createTestRedisClient,
} from '@cube-ai/bun-server-ext-outbox';

const run = await resolveShouldRunTestcontainers();
if (run) setDefaultTimeout(3_600_000);

const stackHolder: { current: MultiEngineStack | null } = { current: null };
const redisHolder: { clients: Redis[] } = { clients: [] };

if (run) {
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      for (const r of redisHolder.clients) {
        await r.quit().catch(() => {});
      }
      redisHolder.clients = [];
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

function nodeIdFromLeaderValue(raw: string | null): string | null {
  if (raw == null || raw === '') return null;
  const c = raw.indexOf(':');
  if (c <= 0) return null;
  return raw.slice(0, c);
}

(run ? describe : describe.skip)(
  '[testcontainers] multi-replica engines: jobs + outbox leader (T14)',
  () => {
    let stack: MultiEngineStack;

    beforeAll(async () => {
      stack = await startMultiEngineStack({
        replicas: 3,
        enableJobWorkers: true,
        withQdrant: false,
        repoRoot: resolveMonorepoRootFromImporter(import.meta.dir),
        enableOutboxRelay: true,
      });
      stackHolder.current = stack;
    }, 1_800_000);

    afterAll(async () => {
      for (const r of redisHolder.clients) {
        await r.quit().catch(() => {});
      }
      redisHolder.clients = [];
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
      await stopTrackedTestcontainersIfAny();
    });

    it('multi-engine stack: 3 replicas all healthy with unique instanceIds + ports', async () => {
      expect(stack.engines.length).toBe(3);

      // unique instance IDs
      const ids = new Set(stack.engines.map((e) => e.instanceId));
      expect(ids.size).toBe(stack.engines.length);

      // unique ports
      const ports = new Set(
        stack.engines.map((e) => new URL(e.baseUrl).port),
      );
      expect(ports.size).toBe(stack.engines.length);

      // /health/live OK on every replica (independent of startup wait)
      const probes = await Promise.all(
        stack.engines.map(async (e) => {
          const r = await fetch(`${e.baseUrl}/health/live`);
          return r.ok;
        }),
      );
      expect(probes.every(Boolean)).toBe(true);
    });

    it('outbox leader election: only one acquirer wins SETNX across N independent redis clients', async () => {
      const key = `agentic:engine:outbox:leader:t14-acq:${Date.now()}`;

      // one ioredis client per engine replica — operationally equivalent
      // to N processes racing for the same lock key.
      const clients: Redis[] = stack.engines.map(
        () => createTestRedisClient(stack.redisUrl),
      );
      redisHolder.clients.push(...clients);

      const elections = stack.engines.map(
        (e, i) =>
          new LeaderElection({
            nodeId: e.instanceId,
            leaderKey: key,
            ttlMs: 5_000,
            redis: createLeaderElectionRedis(clients[i]!),
          }),
      );

      const results = await Promise.all(
        elections.map((le) => le.tryAcquire()),
      );
      const wonCount = results.filter(Boolean).length;
      expect(wonCount).toBe(1);

      // Verify the lock value points at the one winner's instanceId.
      // LeaderElection stores `${nodeId}:${nonce}` — assert prefix.
      const observer = createTestRedisClient(stack.redisUrl);
      redisHolder.clients.push(observer);
      const v = await observer.get(key);
      expect(v).not.toBeNull();
      const winnerIdx = results.findIndex((x) => x === true);
      const expectedPrefix = `${stack.engines[winnerIdx]!.instanceId}:`;
      expect(v!.startsWith(expectedPrefix)).toBe(true);

      // cleanup
      await Promise.all(elections.map((le) => le.release()));
    });

    it('outbox leader handover: leader release → follower probe acquires within 2s', async () => {
      const key = `agentic:engine:outbox:leader:t14-handover:${Date.now()}`;

      const clients: Redis[] = stack.engines.map(
        () => createTestRedisClient(stack.redisUrl),
      );
      redisHolder.clients.push(...clients);

      // Short TTL + fast probe — accelerates handover for the test budget
      // while remaining within `LeaderElection` invariants.
      const elections = stack.engines.map(
        (e, i) =>
          new LeaderElection({
            nodeId: e.instanceId,
            leaderKey: key,
            ttlMs: 5_000,
            renewIntervalMs: 500,
            followerProbeIntervalMs: 300,
            redis: createLeaderElectionRedis(clients[i]!),
          }),
      );

      // Sequential start → first wins, the rest become followers.
      for (const le of elections) {
        await le.start();
      }

      // Probes settle (any follower scheduled at most one probe tick away).
      await new Promise((r) => setTimeout(r, 600));

      const initialLeaderIdx = elections.findIndex((le) => le.isLeader);
      expect(initialLeaderIdx).toBe(0); // sequential start ⇒ deterministic
      const initialLeaderCount = elections.filter((le) => le.isLeader).length;
      expect(initialLeaderCount).toBe(1);

      // Leader voluntarily releases — follower probe (300ms) should pick it up.
      await elections[initialLeaderIdx]!.release();

      const deadline = Date.now() + 2_000;
      let newLeaderIdx = -1;
      while (Date.now() < deadline) {
        newLeaderIdx = elections.findIndex(
          (le, i) => i !== initialLeaderIdx && le.isLeader,
        );
        if (newLeaderIdx !== -1) break;
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(newLeaderIdx).not.toBe(-1);
      expect(newLeaderIdx).not.toBe(initialLeaderIdx);
      // exactly one leader at the end
      expect(elections.filter((le) => le.isLeader).length).toBe(1);

      await Promise.all(elections.map((le) => le.stop()));
    });

    it('SIGTERM on current outbox relay leader → a different replica holds the lock', async () => {
      const redis = createTestRedisClient(stack.redisUrl);
      redisHolder.clients.push(redis);

      const settleDeadline = Date.now() + 30_000;
      let raw: string | null = null;
      while (Date.now() < settleDeadline) {
        raw = await redis.get(DEFAULT_LEADER_KEY);
        if (raw) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(raw).not.toBeNull();
      const initialNodeId = nodeIdFromLeaderValue(raw);
      expect(initialNodeId).not.toBeNull();

      const leaderEngine = stack.engines.find(
        (e) => e.instanceId === initialNodeId,
      );
      expect(leaderEngine).toBeDefined();

      leaderEngine!.sendSignal('SIGTERM');
      await leaderEngine!.waitForExit(60_000);

      const handoverDeadline = Date.now() + 25_000;
      let newNodeId: string | null = null;
      while (Date.now() < handoverDeadline) {
        const v = await redis.get(DEFAULT_LEADER_KEY);
        const nid = nodeIdFromLeaderValue(v);
        if (nid != null && nid !== initialNodeId) {
          newNodeId = nid;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(newNodeId).not.toBeNull();
      expect(newNodeId).not.toBe(initialNodeId);

      const survivors = stack.engines.filter(
        (e) => e.instanceId !== initialNodeId,
      );
      expect(survivors.some((e) => e.instanceId === newNodeId)).toBe(true);
    });

    it.skip('BullMQ jobId is consumed at most once across replicas (follow-up)', async () => {
      // Same auto-start gap as above — additionally this test would need
      // a way to attribute job completion to a specific engine replica
      // (e.g. emit a per-engine processedJobIds channel via Redis pub/sub
      // from a worker hook). Minimum viable shape once relay auto-starts:
      //   - INSERT outbox row { channel: 'bullmq_job',
      //                         payload: { jobId: 'dedup-001', queue, name } }
      //   - poll outbox status → 'PUBLISHED' (≤ 5 s)
      //   - poll BullMQ completed events for the queue / jobId
      //   - assert exactly 1 worker (any replica) handled it
      //   - assert outbox.attempts === 1 and audit_events count === 1
    });

    it.skip('Outbox throughput ≥ 500 events/s for 10K rows on M-series host (follow-up)', async () => {
      // Performance baseline best measured on M-series local hardware;
      // CI shared-runner noise distorts wall-clock. Outline:
      //   - Bulk INSERT 10_000 outbox_events PENDING rows (single multi-row
      //     INSERT to amortize round-trips).
      //   - Start a relay (in-test today, engine-bootstrap when auto-start
      //     lands) with poll=200 ms, batch=100.
      //   - Measure wall-clock from first poll to all 10K rows
      //     `publish_time IS NOT NULL`.
      //   - assert (10_000 / wallSec) >= 500.
    });
  },
);

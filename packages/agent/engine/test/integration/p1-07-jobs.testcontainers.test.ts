import { Queue } from "bullmq";
import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import type Redis from "ioredis";
import { type Pool, type RowDataPacket, createPool } from "mysql2/promise";

import {
  BullMqEnqueueAdapter,
  type BullMqEnqueuePort,
  BullMqJobDispatcher,
  CompositeDispatcher,
  type LeaderElection,
  type OutboxDispatcherI,
  OutboxRelayService,
  OutboxWriterImpl,
  type TransactionContext,
  createTestRedisClient,
} from "@cube-ai/bun-server-ext-outbox";
import {
  type MysqlRedisStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

/**
 * P1-07 Jobs end-to-end — Testcontainers 差异化补丁。
 *
 * **覆盖审计（防重复）**
 *
 * `p1-07-jobs.integration.test.ts` 的 10 条 `test.skip` 中，以下场景已由现有 testcontainers 用例覆盖，本文件不再重复实装：
 *
 *   - leader 单实例 SET NX            → `packages/bun-server-ext-outbox/test/integration/leader-election.testcontainers.test.ts`
 *   - leader 双实例竞争（仅一个 leader）→ 同上
 *   - outbox row 写入 + relay 派发（noop dispatcher）→ `packages/bun-server-ext-outbox/test/integration/outbox-flow.testcontainers.test.ts`
 *   - BullMQ enqueue → Worker 处理 → completed → `packages/agent/engine/test/integration/jobs.testcontainers.test.ts`
 *
 * 本文件补充三条**未被覆盖**的关键不变式（端到端 outbox → relay → BullMQ Queue）：
 *
 *   1. `bullmq_job` channel：outbox INSERT → `OutboxRelayService` + `BullMqJobDispatcher` → BullMQ Queue 出现 jobId
 *   2. 重复 jobId：两条 outbox row（不同 SFID）payload.jobId 相同 → BullMQ Queue 仍仅 1 个 job（idempotent enqueue）
 *   3. dispatcher 持续失败：`attempts` 累加至 10 → outbox row 标记为 `DEAD`（无 ACK）
 *
 * 前置：Docker daemon 可用，通过 `USE_TESTCONTAINERS=1` 触发：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/p1-07-jobs.testcontainers.test.ts
 *
 * 权威：docs/detailed-design/06-jobs/bullmq-protocol.md §3.3 / §5.4 / §5.8
 */

const QUEUE_NAME = "agentic-engine-long-running-jobs";
/** Matches `BullMqEnqueueAdapter` and engine `bullmq-queues.ts` (`agentic:engine:bull`). */
const BULL_PREFIX = "agentic:engine:bull";

const fakeLeader = {
  isLeader: () => true,
  start: async () => {},
  stop: async () => {},
} as unknown as LeaderElection;

const run = await resolveShouldRunTestcontainers();
const stackHolder: { current: MysqlRedisStack | null } = { current: null };
const HOOK_MS = 1_800_000;

if (run) {
  setDefaultTimeout(3_600_000);
  registerProcessShutdown(
    async () => {
      await stopTrackedTestcontainersIfAny();
      if (stackHolder.current) {
        await stackHolder.current.stop().catch(() => {});
        stackHolder.current = null;
      }
    },
    { exitProcessAfterSignal: true },
  );
}

function createMysqlPoolForTest(mysqlUrl: string): Pool {
  return createPool({
    bigNumberStrings: true,
    connectionLimit: 4,
    supportBigNumbers: true,
    uri: mysqlUrl,
  });
}

function nextSfidFactory(): () => string {
  let counter = 1n;
  const base = BigInt(Date.now());
  return () => {
    const id = ((base << 22n) | counter++).toString();
    return id.padStart(19, "1").slice(-19);
  };
}

/**
 * 让队列启用前缀 `agentic:engine:bull`（`BullMqEnqueueAdapter` 内部硬编码同前缀），
 * 这样测试侧 `Queue` 与 dispatcher 共享同一条 Redis key 路径。
 */
function buildVerifierQueue(redis: Redis): Queue {
  return new Queue(QUEUE_NAME, {
    connection: redis,
    prefix: BULL_PREFIX,
  });
}

(run ? describe : describe.skip)("[testcontainers] P1-07 jobs end-to-end (outbox → relay → BullMQ)", () => {
  let pool: Pool;
  let redis: Redis;
  let writer: OutboxWriterImpl;

  beforeAll(async () => {
    const s = await startMysqlRedis();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
    pool = createMysqlPoolForTest(s.mysqlUrl);
    redis = createTestRedisClient(s.redisUrl);
    writer = new OutboxWriterImpl({ nextSfid: nextSfidFactory() });
  }, HOOK_MS);

  afterAll(async () => {
    try {
      await redis?.quit();
    } catch {
      /* noop */
    }
    try {
      await pool?.end();
    } catch {
      /* noop */
    }
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  /**
   * 在事务内 INSERT 一条 outbox row（用 `OutboxWriterImpl`），返回行 `id`。
   */
  async function insertOutboxRow(input: {
    tenant: number;
    channel: "bullmq_job";
    eventType: string;
    payload: Record<string, unknown>;
    target: string | null;
  }): Promise<string> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx: TransactionContext = {
        _brand: "TransactionContext",
        mysqlConnection: conn,
      };
      await writer.append(tx, {
        channel: input.channel,
        eventType: input.eventType,
        payloadJson: input.payload,
        /** 防止容器/宿主机时钟漂移把行排除在 schedule_time<=NOW(3) 之外 */
        scheduleTime: Date.now() - 3_600_000,
        target: input.target,
        tenant: input.tenant,
      });
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT CAST(id AS CHAR) AS id FROM outbox_events
             WHERE tenant = ? AND channel = ? AND event_type = ?
             ORDER BY create_time DESC LIMIT 1`,
        [input.tenant, input.channel, input.eventType],
      );
      await conn.commit();
      const id = (rows[0] as { id?: string } | undefined)?.id ?? "";
      if (!id) {
        throw new Error("insertOutboxRow: missing id after INSERT");
      }
      return id;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  async function selectOutboxStatus(id: string): Promise<{
    status: string;
    attempts: number;
    lastError: string | null;
  }> {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT status, attempts, last_error FROM outbox_events WHERE id = ?`, [id]);
    const r = rows[0] as { status?: string; attempts?: number; last_error?: string | null } | undefined;
    return {
      attempts: Number(r?.attempts ?? -1),
      lastError: r?.last_error ?? null,
      status: String(r?.status ?? ""),
    };
  }

  /**
   * Test 1 — 端到端：outbox row(`bullmq_job`) → `OutboxRelayService` 选中 →
   * `BullMqJobDispatcher` enqueue → BullMQ `Queue` 内出现 jobId 对应 job；
   * outbox row 状态 PUBLISHED。
   */
  it("outbox bullmq_job row → relay → BullMQ Queue.add (jobId 出现)", async () => {
    const tenant = 8_001;
    const jobId = `tc-${Date.now()}-1`;

    const id = await insertOutboxRow({
      channel: "bullmq_job",
      eventType: "job.long_running",
      payload: { jobId, payloadKind: "tool_call", tenant },
      target: QUEUE_NAME,
      tenant,
    });

    const enqueueAdapter = new BullMqEnqueueAdapter(redis);
    const dispatcher: OutboxDispatcherI = new CompositeDispatcher(new BullMqJobDispatcher(enqueueAdapter));

    const relay = new OutboxRelayService(fakeLeader, dispatcher, {
      batchSize: 10,
      isRelayLeader: () => true,
      mysqlPool: pool,
      /** 避免后台 timer 在 stop() 之前再次扫描行 */
      pollIntervalMs: 600_000,
    });
    await relay.start(dispatcher);
    await relay.relayOnce();
    await relay.stop();

    const after = await selectOutboxStatus(id);
    expect(after.status).toBe("PUBLISHED");
    expect(after.attempts).toBe(0);

    const verifier = buildVerifierQueue(redis);
    try {
      const job = await verifier.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job?.id).toBe(jobId);
    } finally {
      await verifier.close();
    }
  });

  /**
   * Test 2 — 重复 jobId：两条 outbox row（不同 SFID）payload.jobId 相同 →
   * BullMQ 队列里仅 1 个 job（add(jobId, …) 自带去重）。
   *
   * Ref: bullmq-protocol.md §3.3 / §11 test #2
   */
  it("重复 jobId 通过 outbox 派发两次 → BullMQ 仅 1 个 job", async () => {
    const tenant = 8_002;
    const jobId = `tc-${Date.now()}-dup`;

    const id1 = await insertOutboxRow({
      channel: "bullmq_job",
      eventType: "job.long_running",
      payload: { attempt: 1, jobId, tenant },
      target: QUEUE_NAME,
      tenant,
    });
    const id2 = await insertOutboxRow({
      channel: "bullmq_job",
      eventType: "job.long_running",
      payload: { attempt: 2, jobId, tenant },
      target: QUEUE_NAME,
      tenant,
    });
    expect(id1).not.toBe(id2);

    const enqueueAdapter = new BullMqEnqueueAdapter(redis);
    const dispatcher: OutboxDispatcherI = new CompositeDispatcher(new BullMqJobDispatcher(enqueueAdapter));

    const relay = new OutboxRelayService(fakeLeader, dispatcher, {
      batchSize: 10,
      isRelayLeader: () => true,
      mysqlPool: pool,
      pollIntervalMs: 600_000,
    });
    await relay.start(dispatcher);
    await relay.relayOnce();
    await relay.stop();

    expect((await selectOutboxStatus(id1)).status).toBe("PUBLISHED");
    expect((await selectOutboxStatus(id2)).status).toBe("PUBLISHED");

    const verifier = buildVerifierQueue(redis);
    try {
      const job = await verifier.getJob(jobId);
      expect(job).not.toBeNull();
      expect(job?.id).toBe(jobId);

      /** 整队列里 jobId == 我们的 → 只有 1 个 */
      const all = await verifier.getJobs(["waiting", "active", "delayed", "paused", "completed", "failed"], 0, 50);
      const matched = all.filter((j) => j.id === jobId);
      expect(matched.length).toBe(1);
    } finally {
      await verifier.close();
    }
  });

  /**
   * Test 3 — 持续失败 10 次后 outbox row 进入 `DEAD`（无 BullMQ enqueue）。
   *
   * 受限于 relay 的指数退避（1s/4s/16s/…），手动把 `next_attempt_time = NULL`
   * 推动每次轮询都能选中同一行；配合 always-fail dispatcher 累加 attempts。
   *
   * Ref: bullmq-protocol.md §5.8 / §11 test #4
   */
  it("relay dispatcher 连续失败 10 次 → outbox row 标 DEAD", async () => {
    const tenant = 8_003;
    const jobId = `tc-${Date.now()}-dead`;

    const id = await insertOutboxRow({
      channel: "bullmq_job",
      eventType: "job.long_running",
      payload: { jobId, tenant },
      target: QUEUE_NAME,
      tenant,
    });

    const failingEnqueue: BullMqEnqueuePort = {
      add: async () => {
        throw new Error("enqueue always fails (simulated)");
      },
    };
    const dispatcher: OutboxDispatcherI = new CompositeDispatcher(new BullMqJobDispatcher(failingEnqueue));

    const relay = new OutboxRelayService(fakeLeader, dispatcher, {
      batchSize: 10,
      isRelayLeader: () => true,
      mysqlPool: pool,
      /** 长 interval 防 timer 干扰精确 attempts 计数 */
      pollIntervalMs: 600_000,
    });
    await relay.start(dispatcher);
    try {
      for (let i = 0; i < 12; i++) {
        await relay.relayOnce();
        const cur = await selectOutboxStatus(id);
        if (cur.status === "DEAD") {
          break;
        }
        /** 推平指数退避，触发下一次扫描 */
        await pool.query(`UPDATE outbox_events SET next_attempt_time = NULL WHERE id = ?`, [id]);
      }
    } finally {
      await relay.stop();
    }

    const final = await selectOutboxStatus(id);
    expect(final.status).toBe("DEAD");
    expect(final.attempts).toBeGreaterThanOrEqual(10);
    expect(final.lastError).toContain("enqueue always fails");
  });
});

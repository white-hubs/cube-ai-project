import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Pool, type RowDataPacket, createPool } from "mysql2/promise";

import { OutboxWriterImpl, type TransactionContext } from "@cube-ai/bun-server-ext-outbox";
import { type AppendOutboxInput, OutboxEventRowSchema } from "@cube-ai/contracts";
import {
  type MysqlOnlyStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlOnly,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

/**
 * outbox_events 表 + OutboxWriter — Testcontainers 集成测试。
 *
 * 迁移自 `outbox.integration.test.ts`（保留为 Phase-1 placeholder，全 skip）。
 *
 * 前置：Docker daemon 可用，通过 `USE_TESTCONTAINERS=1` 触发：
 *   bun run test:containers
 *   USE_TESTCONTAINERS=1 bun test packages/agent/engine/test/integration/outbox.testcontainers.test.ts
 *
 * 覆盖（与 mysql-redis-qdrant.testcontainers.test.ts 互补，避免重复）：
 *   1. DDL：information_schema 校验 outbox_events 必备列
 *   2. INSERT 一条 outbox row（OutboxWriterImpl + Tx）→ SELECT 回读 + Schema parse
 *   3. soft-delete：UPDATE deleted = NOW(3) 后回读 deleted ≠ 0
 *   4. target / payloadJson JSON 字段往返
 *   5. tenant 越界（INT(10) ≤ 2,147,483,647）契约 schema 拒绝
 *   6. usage_event channel：3 个 eventType（usage.llm_call / usage.tool_call / usage.job_duration）
 *
 * 权威：docs/detailed-design/06-jobs/README.md §4.1 / 02-data/mysql-tables.md §6.2
 */

const run = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlOnlyStack | null } = { current: null };
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

function createOutboxPool(mysqlUrl: string): Pool {
  return createPool({
    bigNumberStrings: true,
    connectionLimit: 4,
    supportBigNumbers: true,
    uri: mysqlUrl,
  });
}

function nextSfidFactory(): () => string {
  /** Monotonic 19-digit SFID generator scoped to a test (not Twitter epoch). */
  let counter = 1n;
  const base = BigInt(Date.now());
  return () => {
    const id = ((base << 22n) | counter++).toString();
    return id.padStart(19, "1").slice(-19);
  };
}

(run ? describe : describe.skip)("[testcontainers] outbox_events table — Testcontainers", () => {
  let pool: Pool;
  let writer: OutboxWriterImpl;

  beforeAll(async () => {
    const s = await startMysqlOnly();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
    pool = createOutboxPool(s.mysqlUrl);
    writer = new OutboxWriterImpl({ nextSfid: nextSfidFactory() });
  }, HOOK_MS);

  afterAll(async () => {
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
   * Helper: append within a managed transaction (matches OutboxWriter contract).
   */
  async function appendInTx(input: AppendOutboxInput): Promise<void> {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const tx: TransactionContext = {
        _brand: "TransactionContext",
        mysqlConnection: conn,
      };
      await writer.append(tx, input);
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  }

  it("DDL creates outbox_events table with all required columns", async () => {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbox_events'`,
    );
    const names = (rows as { COLUMN_NAME: string }[]).map((r) => r.COLUMN_NAME);
    const required = [
      "id",
      "tenant",
      "channel",
      "event_type",
      "payload_json",
      "target",
      "status",
      "attempts",
      "last_error",
      "schedule_time",
      "publish_time",
      "next_attempt_time",
      "deleted",
      "create_by",
      "creator_id",
      "creator_type",
      "create_time",
      "update_by",
      "updater_id",
      "updater_type",
      "update_time",
    ];
    for (const c of required) {
      expect(names).toContain(c);
    }
  });

  it("INSERT a valid outbox row via OutboxWriter and SELECT it back", async () => {
    const tenant = 1_001;
    const input: AppendOutboxInput = {
      channel: "usage_bus",
      eventType: "usage.job_duration",
      payloadJson: {
        attempts: 1,
        execDurationMs: 900,
        finalStatus: "COMPLETED",
        jobId: "1820345678900000000",
        occurredTime: Date.now(),
        schema: "usage.job_duration.v1",
        tenant,
        toolName: "platform.flow.invoke",
        toolRef: "builtin:platform.flow.invoke",
        totalDurationMs: 1_000,
        waitDurationMs: 100,
      },
      scheduleTime: Date.now(),
      target: null,
      tenant,
    };

    await appendInTx(input);

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id, tenant, channel, event_type, payload_json,
                status, attempts, last_error, schedule_time,
                publish_time, next_attempt_time, target, deleted,
                create_by, creator_id, creator_type, create_time,
                update_by, updater_id, updater_type, update_time
           FROM outbox_events
           WHERE tenant = ? AND event_type = 'usage.job_duration'
           ORDER BY create_time DESC LIMIT 1`,
      [tenant],
    );
    expect(rows.length).toBe(1);
    const r = rows[0]!;

    const camel = {
      attempts: Number(r["attempts"]),
      channel: r["channel"] as string,
      createBy: String(r["create_by"]),
      createTime: new Date(r["create_time"] as string).getTime(),
      creatorId: r["creator_id"] !== null && r["creator_id"] !== undefined ? String(r["creator_id"]) : null,
      creatorType: r["creator_type"] as "USER" | "SERVICE" | "SYSTEM" | null,
      deleted: Number(r["deleted"]),
      eventType: r["event_type"] as string,
      id: String(r["id"]),
      lastError: r["last_error"] !== null && r["last_error"] !== undefined ? String(r["last_error"]) : null,
      nextAttemptTime:
        r["next_attempt_time"] !== null && r["next_attempt_time"] !== undefined
          ? new Date(r["next_attempt_time"] as string).getTime()
          : null,
      payloadJson:
        typeof r["payload_json"] === "string" ? (JSON.parse(r["payload_json"] as string) as unknown) : (r["payload_json"] as unknown),
      publishTime: r["publish_time"] !== null && r["publish_time"] !== undefined ? new Date(r["publish_time"] as string).getTime() : null,
      scheduleTime: new Date(r["schedule_time"] as string).getTime(),
      status: r["status"] as string,
      target: r["target"] !== null && r["target"] !== undefined ? String(r["target"]) : null,
      tenant: Number(r["tenant"]),
      updateBy: String(r["update_by"]),
      updateTime: new Date(r["update_time"] as string).getTime(),
      updaterId: r["updater_id"] !== null && r["updater_id"] !== undefined ? String(r["updater_id"]) : null,
      updaterType: r["updater_type"] as "USER" | "SERVICE" | "SYSTEM" | null,
    };
    const parsed = OutboxEventRowSchema.safeParse(camel);
    expect(parsed.success).toBe(true);
    expect(camel.status).toBe("PENDING");
    expect(camel.attempts).toBe(0);
    expect(camel.deleted).toBe(0);
    expect(camel.createBy).toBe("system");
    expect(camel.creatorType).toBe("SYSTEM");
  });

  it("soft-delete sets deleted to epoch ms (non-zero)", async () => {
    const tenant = 1_002;
    await appendInTx({
      channel: "session_lifecycle",
      eventType: "session.deleted",
      payloadJson: { sessionId: "1234567890123456789", tenant },
      scheduleTime: Date.now(),
      target: null,
      tenant,
    });

    const [pre] = await pool.query<RowDataPacket[]>(
      `SELECT id, deleted FROM outbox_events
           WHERE tenant = ? AND event_type = 'session.deleted'
           ORDER BY create_time DESC LIMIT 1`,
      [tenant],
    );
    expect(pre.length).toBe(1);
    const id = String(pre[0]!["id"]);
    expect(Number(pre[0]!["deleted"])).toBe(0);

    const epochSeconds = Math.floor(Date.now() / 1000);
    await pool.query(`UPDATE outbox_events SET deleted = ?, update_time = NOW(3) WHERE id = ?`, [epochSeconds, id]);

    const [post] = await pool.query<RowDataPacket[]>(`SELECT deleted FROM outbox_events WHERE id = ?`, [id]);
    expect(post.length).toBe(1);
    const deletedNum = Number(post[0]!["deleted"]);
    expect(deletedNum).not.toBe(0);
    expect(deletedNum).toBeGreaterThan(0);
  });

  it("target / payloadJson JSON fields round-trip correctly", async () => {
    const tenant = 1_003;
    const target = "queue:tc-target";
    const complexPayload = {
      nested: {
        arr: [1, "two", { three: true }],
        when: Date.now(),
      },
      schema: "session.created.v1",
      sessionId: "1234567890123456789",
      tenant,
      unicode: "中文テスト🎉",
    };

    await appendInTx({
      channel: "session_lifecycle",
      eventType: "session.created",
      payloadJson: complexPayload,
      scheduleTime: Date.now(),
      target,
      tenant,
    });

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT target, payload_json FROM outbox_events
           WHERE tenant = ? AND event_type = 'session.created'
           ORDER BY create_time DESC LIMIT 1`,
      [tenant],
    );
    expect(rows.length).toBe(1);

    expect(String(rows[0]!["target"])).toBe(target);
    const raw = rows[0]!["payload_json"];
    const payload = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    expect(payload).toEqual(complexPayload);
  });

  it("tenant must be within INT(10) range — schema rejects overflow", async () => {
    const overflowInput = {
      channel: "usage_bus" as const,
      eventType: "usage.job_duration",
      payloadJson: { schema: "usage.job_duration.v1" },
      scheduleTime: Date.now(),
      target: null,
      tenant: 2_147_483_648,
    };

    await expect(appendInTx(overflowInput as unknown as AppendOutboxInput)).rejects.toThrow();

    const [rows] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM outbox_events WHERE tenant = ?`, [overflowInput.tenant]);
    expect(Number(rows[0]!["c"])).toBe(0);
  });

  it("usage_event channel: writes 3 eventType rows (llm_call/tool_call/job_duration)", async () => {
    const tenant = 1_004;
    const eventTypes = ["usage.llm_call", "usage.tool_call", "usage.job_duration"] as const;

    for (const eventType of eventTypes) {
      await appendInTx({
        channel: "usage_event",
        eventType,
        payloadJson: { schema: `${eventType}.v1`, tenant },
        scheduleTime: Date.now(),
        target: null,
        tenant,
      });
    }

    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT event_type, channel FROM outbox_events
           WHERE tenant = ? AND channel = 'usage_event'
           ORDER BY create_time ASC`,
      [tenant],
    );
    const types = (rows as { event_type: string; channel: string }[]).map((r) => r.event_type).toSorted();
    expect(types).toEqual([...eventTypes].toSorted());

    const channels = (rows as { channel: string }[]).map((r) => r.channel);
    expect(new Set(channels)).toEqual(new Set(["usage_event"]));
  });
});

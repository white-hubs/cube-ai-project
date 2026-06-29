/**
 * P1-03 Data layer — integration test skeleton.
 *
 * All tests are deliberately skipped in Phase 1 — these require live MySQL
 * and Redis infrastructure, plus the ORM / migration tooling, which is wired
 * by the user in Phase 2 per Q-M2-8 (real integrations are configuration
 * driven and verified manually).
 *
 * To enable:
 *   1. Bring up infra: see ../../../../docs/technical-design/phase-1/P1-03/runbook.md
 *      (docker compose up -d for mysql + redis + adminer)
 *   2. Apply schema: bun run --filter '@cube-ai/agent-engine' migrate
 *   3. Export env vars from docs/technical-design/phase-1/P1-03/config/.env.example
 *   4. Remove `.skip` from each test below; or run with INTEGRATION_TESTS=1
 *
 * Phase 2.A horizontal review noted the original copy was misplaced under
 * `docs/.../P1-03/config/` where `bun test` did discover it but the package
 * resolver could not reach `@cube-ai/contracts`. Phase 2.B relocated
 * it to the canonical `packages/<pkg>/test/integration/*.integration.test.ts`
 * path (per shared-context §4.4) and ensured every test stays `test.skip`.
 *
 * Refs:
 *   - docs/technical-design/phase-1/P1-03-data-outbox.md §8
 *   - docs/technical-design/phase-2-review.md §8.1
 */

import { describe, expect, test } from "bun:test";

import { type AppendOutboxInput, OutboxEventRowSchema } from "@cube-ai/contracts";

// ---------------------------------------------------------------------------
// Helpers (stubs — replace with real DB client in Phase 2)
// ---------------------------------------------------------------------------

/**
 * Phase 4 (T03): outbox.integration.test.ts retained as a skipped placeholder.
 * The real DB-backed coverage now lives in `outbox.testcontainers.test.ts`
 * which spins up MySQL via Testcontainers (`USE_TESTCONTAINERS=1`).
 *
 * Keeping this file with all-skip suites preserves the historical Phase-1/2
 * design references; the throwing helper is replaced by a rejecting Promise
 * since none of the tests below actually reach it (they're `test.skip`).
 */
async function getConnection(): Promise<never> {
  throw new Error("outbox.integration.test.ts is a Phase-1 placeholder; use outbox.testcontainers.test.ts instead");
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe("[integration] outbox_events table", () => {
  test.skip("DDL creates outbox_events table with all required columns", async () => {
    const db = await getConnection();
    // Phase 2: run migration, then verify INFORMATION_SCHEMA.COLUMNS
    // const columns = await db('information_schema.COLUMNS').where({ TABLE_NAME: 'outbox_events' });
    // const names = columns.map((c: Record<string, string>) => c.COLUMN_NAME);
    // expect(names).toContain('id');
    // expect(names).toContain('tenant');
    // ... etc
    expect(db).toBeDefined();
  });

  test.skip("INSERT a valid outbox row and SELECT it back", async () => {
    const db = await getConnection();

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
        tenant: 1001,
        toolName: "platform.flow.invoke",
        toolRef: "builtin:platform.flow.invoke",
        totalDurationMs: 1000,
        waitDurationMs: 100,
      },
      scheduleTime: Date.now(),
      target: null,
      tenant: 1001,
    };

    // Phase 2: call real OutboxWriterImpl.append with a real TX
    // const [id] = await db('outbox_events').insert({ ... mapToSnakeCase(input), ... });
    // const [row] = await db('outbox_events').where({ id });
    // const parsed = OutboxEventRowSchema.safeParse(mapToCamelCase(row));
    // expect(parsed.success).toBe(true);

    expect(input).toBeDefined();
    expect(OutboxEventRowSchema).toBeDefined();
    void db;
  });

  test.skip("soft-delete sets deleted = epoch ms (non-zero)", async () => {
    const db = await getConnection();
    // Phase 2: INSERT row, then soft-delete it, then verify deleted != 0
    expect(db).toBeDefined();
  });
});

describe("[integration] session table", () => {
  test.skip("INSERT a session row and retrieve it via SessionRepository", async () => {
    const db = await getConnection();
    // Phase 2: wire SessionRepositoryImpl with real knex/drizzle
    expect(db).toBeDefined();
  });
});

describe("[integration] usage_events table", () => {
  test.skip("INSERT three usage event types and verify eventType values", async () => {
    const db = await getConnection();
    // Phase 2: batch insert usage.llm_call, usage.tool_call, usage.job_duration rows
    expect(db).toBeDefined();
  });
});

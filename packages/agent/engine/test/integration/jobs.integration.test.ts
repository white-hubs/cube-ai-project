/**
 * Jobs E2E — 占位；BullMQ smoke 见 `jobs.testcontainers.test.ts`（USE_TESTCONTAINERS=1）。
 */
import { describe, expect, test } from "bun:test";

describe.skip("P3-09 jobs integration (live Redis+MySQL)", () => {
  test("enqueue → BullMQ pickup → processor → job COMPLETED", async () => {
    // 1. SET AGENTIC_ENGINE_MYSQL_URL + AGENTIC_ENGINE_REDIS_URL
    // 2. Run DB migrations
    // 3. Start engine with AGENTIC_ENGINE_ENABLE_JOB_WORKERS=true
    // 4. Call scheduler enqueueSessionTurn or insert + relay
    // 5. Assert jobs.status = 'COMPLETED' in MySQL
    expect(true).toBe(true);
  });
});

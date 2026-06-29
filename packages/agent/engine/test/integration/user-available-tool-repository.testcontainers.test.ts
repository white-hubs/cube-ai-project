import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createPool } from "mysql2/promise";

import {
  type MysqlRedisStack,
  applyMinimalMysqlSchema,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { UserAvailableToolRepositoryImpl } from "../../src/bc/descriptor/user-available-tool.repository";
import { SfidService } from "../../src/infra/sfid/sfid.service";

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

(run ? describe : describe.skip)("UserAvailableToolRepository [testcontainers]", () => {
  beforeAll(async () => {
    const s = await startMysqlRedis();
    try {
      await applyMinimalMysqlSchema(s.mysqlUrl);
      stackHolder.current = s;
    } catch (e) {
      await s.stop();
      throw e;
    }
  }, HOOK_MS);

  afterAll(async () => {
    if (stackHolder.current) {
      await stackHolder.current.stop().catch(() => {});
      stackHolder.current = null;
    }
    await stopTrackedTestcontainersIfAny();
  });

  test(
    "install, patch, list and remove available tools",
    async () => {
      const pool = createPool({ connectionLimit: 2, uri: stackHolder.current!.mysqlUrl });
      try {
        const repo = new UserAvailableToolRepositoryImpl(pool, new SfidService());
        const installed = await repo.insert(901, "bob", "currentDate");
        expect(installed).toEqual({ enabled: true, toolName: "currentDate" });
        expect(await repo.findByName(901, "bob", "currentDate")).toEqual(installed);

        expect(await repo.patch(901, "bob", "currentDate", false)).toEqual({
          enabled: false,
          toolName: "currentDate",
        });
        expect(await repo.listByUser(901, "bob")).toEqual([{ enabled: false, toolName: "currentDate" }]);

        await repo.softDelete(901, "bob", "currentDate");
        expect(await repo.listByUser(901, "bob")).toEqual([]);
      } finally {
        await pool.end();
      }
    },
    HOOK_MS,
  );
});

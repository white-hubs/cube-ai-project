import { setDefaultTimeout } from "bun:test";

import {
  type MysqlRedisStack,
  applyAiCenterDomainMysqlSchemas,
  registerProcessShutdown,
  resolveShouldRunTestcontainers,
  startMysqlRedis,
  stopTrackedTestcontainersIfAny,
} from "@cube-ai/test-infra";

import { applyAiCenterIntegrationTestEnv, restoreAiCenterTestEnv, snapshotAiCenterTestEnv } from "./ai-center-test-env";

export const shouldRunAiCenterIntegration = await resolveShouldRunTestcontainers();

const stackHolder: { current: MysqlRedisStack | null } = { current: null };

if (shouldRunAiCenterIntegration) {
  setDefaultTimeout(180_000);
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

export async function startAiCenterIntegrationStack(): Promise<{
  envSnapshot: Record<string, string | undefined>;
}> {
  const envSnapshot = snapshotAiCenterTestEnv();
  const stack = await startMysqlRedis();
  stackHolder.current = stack;
  await applyAiCenterDomainMysqlSchemas(stack.mysqlUrl);
  applyAiCenterIntegrationTestEnv({ mysqlUrl: stack.mysqlUrl, redisUrl: stack.redisUrl });
  return { envSnapshot };
}

export async function stopAiCenterIntegrationStack(envSnapshot: Record<string, string | undefined>): Promise<void> {
  restoreAiCenterTestEnv(envSnapshot);
  if (stackHolder.current) {
    await stackHolder.current.stop().catch(() => {});
    stackHolder.current = null;
  }
}

export { testInfraLog, withProgressLog } from "./log";
export { INTEGRATION_AGENT_DESCRIPTOR_DIR, INTEGRATION_AGENT_ID } from "./integration-agent-fixture";
export { applyMinimalMysqlSchema, applyGrantsMysqlSchema, applyAiCenterDomainMysqlSchemas } from "./apply-schema";
export { startEngineIntegrationProcess } from "./engine-subprocess";
export type { EngineIntegrationProcess } from "./engine-subprocess";
export { getFreePort } from "./free-port";
export { startMultiEngineStack } from "./multi-engine-stack";
export type { MultiEngineStack, StartMultiEngineStackOptions } from "./multi-engine-stack";
export { registerMysqlRedisQdrantCleanup, registerProcessShutdown, type RegisterProcessShutdownOptions } from "./process-cleanup";
export { stopAllTrackedTestinfra } from "./emergency-cleanup";
export { findMonorepoRoot, resolveBunExecutable, resolveEnginePackageDir, resolveMonorepoRootFromImporter } from "./repo-path";
export {
  createMysqlReadyWaitStrategy,
  startMysqlOnly,
  startMysqlRedis,
  startMysqlRedisQdrant,
  startRedisOnly,
  stopTrackedTestcontainersIfAny,
} from "./stack";
export type { MysqlOnlyStack, MysqlRedisQdrantStack, MysqlRedisStack, RedisOnlyStack } from "./stack";
export {
  startNacosServer,
  stopTrackedNacosIfAny,
  publishNacosConfig,
  waitForNacosConfigReadable,
  seedAgenticDescriptorNacosFixtures,
  NACOS_DESCRIPTOR_GROUP_DEFAULT,
  NACOS_SEED_ECHO_FIXTURE,
  NACOS_SEED_FIXTURE_DIR,
  NACOS_SEED_INDEX_FIXTURE,
  INTEGRATION_TOOL_DESCRIPTOR_SAMPLE_DIR,
} from "./nacos-stack";
export type { NacosServerStack, PublishNacosConfigOpts } from "./nacos-stack";
export {
  resolveShouldRunNacosTestcontainers,
  resolveShouldRunOllamaE2e,
  resolveShouldRunTestcontainers,
  shouldRunNacosTestcontainers,
  shouldRunOllamaE2e,
  shouldRunTestcontainers,
} from "./run-gates";
export { startOllamaWithModel, stopTrackedOllamaIfAny } from "./ollama-container";
export type { OllamaStack, StartOllamaWithModelOptions } from "./ollama-container";
export { startOtelCollector, stopTrackedOtelCollectorIfAny } from "./otel-collector";
export type { OtelCollectorStack } from "./otel-collector";

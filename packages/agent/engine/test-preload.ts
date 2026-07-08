import "reflect-metadata";
import { registerProcessShutdown, stopAllTrackedTestinfra } from "@cube-ai/test-infra";

/**
 * Fix A (SFID fail-closed): production 不再静默默认 nodeId=0；未配置时
 * `SfidService.next()` 抛错。离线测试进程没有 Redis 节点租约，这里给一个确定
 * 的显式 nodeId，让 `sharedSfidService` 及各 `new SfidService()` 在测试内可用。
 * 生产不加载本 preload，fail-closed 语义不受影响。
 */
process.env.AGENTIC_ENGINE_NODE_ID ??= "1";

/**
 * 全局 Testcontainers 兜底 teardown（同步注册，避免异步 import 竞态）。
 * 与各用例 afterAll / registerProcessShutdown 链式叠加；具体用例仍负责 engine 子进程等。
 */
const useContainers =
  process.env["USE_TESTCONTAINERS"] === "1" || process.env["USE_NACOS_TESTCONTAINERS"] === "1" || process.env["RUN_OLLAMA_E2E"] === "1";

if (useContainers) {
  registerProcessShutdown(() => stopAllTrackedTestinfra());
}

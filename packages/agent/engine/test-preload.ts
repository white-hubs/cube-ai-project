import 'reflect-metadata';
import { registerProcessShutdown, stopAllTrackedTestinfra } from '@cube-ai/test-infra';

/**
 * 全局 Testcontainers 兜底 teardown（同步注册，避免异步 import 竞态）。
 * 与各用例 afterAll / registerProcessShutdown 链式叠加；具体用例仍负责 engine 子进程等。
 */
const useContainers =
  process.env['USE_TESTCONTAINERS'] === '1' ||
  process.env['USE_NACOS_TESTCONTAINERS'] === '1' ||
  process.env['RUN_OLLAMA_E2E'] === '1';

if (useContainers) {
  registerProcessShutdown(() => stopAllTrackedTestinfra());
}

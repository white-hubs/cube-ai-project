import type { MysqlRedisQdrantStack } from "./stack";

export interface RegisterProcessShutdownOptions {
  /**
   * 为 true 时：信号触发且在 teardown 结束后 `process.exit`（常见 130/143）。
   * 集成测试建议开启，否则运行时可能在异步 `container.stop()` 完成前就退出，容器不会被删掉。
   */
  exitProcessAfterSignal?: boolean;
}

interface ShutdownEntry {
  fn: () => void | Promise<void>;
  exitProcessAfterSignal: boolean;
}

const entries: ShutdownEntry[] = [];
let listenersInstalled = false;
let shutdownOnce = false;

async function runAllShutdownHandlers(signal: NodeJS.Signals): Promise<void> {
  if (shutdownOnce) {
    return;
  }
  shutdownOnce = true;

  const shouldExit = entries.some((e) => e.exitProcessAfterSignal);

  for (const entry of [...entries].toReversed()) {
    try {
      await entry.fn();
    } catch {
      /* ignore teardown errors */
    }
  }

  if (shouldExit) {
    const code = signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 129;
    process.exit(code);
  }
}

function ensureSignalListeners(): void {
  if (listenersInstalled) {
    return;
  }
  listenersInstalled = true;

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.once(sig, () => {
      void runAllShutdownHandlers(sig);
    });
  }
}

/**
 * SIGINT / SIGTERM / SIGHUP 时执行自定义 teardown（如先停 Engine 再停 Docker）。
 * 多次注册会按 LIFO 顺序依次执行（后注册的先跑），避免仅首个回调生效导致孤儿容器。
 */
export function registerProcessShutdown(fn: () => void | Promise<void>, options?: RegisterProcessShutdownOptions): void {
  entries.push({
    exitProcessAfterSignal: options?.exitProcessAfterSignal === true,
    fn,
  });
  ensureSignalListeners();
}

/**
 * @deprecated 使用 {@link registerProcessShutdown}，在回调里先停 Engine 再停 stack。
 */
export function registerMysqlRedisQdrantCleanup(getStack: () => MysqlRedisQdrantStack | null): void {
  registerProcessShutdown(async () => {
    const s = getStack();
    if (s) {
      await s.stop();
    }
  });
}

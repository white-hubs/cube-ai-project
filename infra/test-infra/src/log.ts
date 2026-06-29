/**
 * 写入 stderr，避免长时间静默（Testcontainers 拉镜像 / 等就绪时往往数分钟无输出）。
 * TTY 下 stderr 通常为行缓冲或无缓冲，比 stdout 更容易即时显示。
 */
export function testInfraLog(message: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  process.stderr.write(`[test-infra ${ts}] ${message}\n`);
}

/**
 * Testcontainers 在 `.start()` 内阻塞期间不打日志（镜像已缓存时多为容器创建 + DB 就绪探测，
 * MySQL 首次初始化常见 30–90s）。包一层以便周期性心跳。
 */
export async function withProgressLog<T>(label: string, work: Promise<T>, intervalMs = 10_000): Promise<T> {
  const startedAt = Date.now();
  const id = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    testInfraLog(`still working: ${label} (${s}s) — image pull 完成后仍可能很慢（如 MySQL 首次 init / 等健康检查）`);
  }, intervalMs);
  try {
    return await work;
  } finally {
    clearInterval(id);
  }
}

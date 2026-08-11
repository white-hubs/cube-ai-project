/** Low-cardinality process metrics for retrieval degradation and model cost/latency. */
export interface RetrievalOperationalMetricsSnapshot {
  modelRerankAttempts: number;
  modelRerankFallbacks: number;
  modelRerankSuccesses: number;
  modelRerankLatencyMsTotal: number;
  modelRerankLastLatencyMs: number;
}

const metrics: RetrievalOperationalMetricsSnapshot = {
  modelRerankAttempts: 0,
  modelRerankFallbacks: 0,
  modelRerankLastLatencyMs: 0,
  modelRerankLatencyMsTotal: 0,
  modelRerankSuccesses: 0,
};

export function recordModelRerankAttempt(): number {
  metrics.modelRerankAttempts += 1;
  return performance.now();
}

export function recordModelRerankSuccess(startedAt: number): void {
  recordLatency(startedAt);
  metrics.modelRerankSuccesses += 1;
}

export function recordModelRerankFallback(startedAt: number): void {
  recordLatency(startedAt);
  metrics.modelRerankFallbacks += 1;
}

function recordLatency(startedAt: number): void {
  const elapsed = Math.max(0, performance.now() - startedAt);
  metrics.modelRerankLastLatencyMs = elapsed;
  metrics.modelRerankLatencyMsTotal += elapsed;
}

export function getRetrievalOperationalMetrics(): Readonly<RetrievalOperationalMetricsSnapshot> {
  return { ...metrics };
}

export function resetRetrievalOperationalMetricsForTests(): void {
  Object.assign(metrics, {
    modelRerankAttempts: 0,
    modelRerankFallbacks: 0,
    modelRerankLastLatencyMs: 0,
    modelRerankLatencyMsTotal: 0,
    modelRerankSuccesses: 0,
  });
}

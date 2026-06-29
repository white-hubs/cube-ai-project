import { currentTenantId } from "@cube-ai/tenant-context";

export interface FlowRunMetric {
  flowId: string;
  taskId: string;
  latencyMs: number;
  stream: boolean;
  hadError: boolean;
  tenantId?: string | null;
  ttftMs?: number;
  approxOutputChars?: number;
  at: number;
}

const recent: FlowRunMetric[] = [];
const MAX_RECENT = 2000;

function pushMetric(m: FlowRunMetric): void {
  recent.push(m);
  if (recent.length > MAX_RECENT) {
    recent.splice(0, recent.length - MAX_RECENT);
  }
}

export function recordFlowExecutionFromSse(ctx: {
  flowId: string;
  taskId: string;
  startedAtMs: number;
  hadError: boolean;
  ttftMs?: number;
  approxOutputChars?: number;
}): void {
  pushMetric({
    approxOutputChars: ctx.approxOutputChars,
    at: Date.now(),
    flowId: ctx.flowId,
    hadError: ctx.hadError,
    latencyMs: Math.max(0, Date.now() - ctx.startedAtMs),
    stream: true,
    taskId: ctx.taskId,
    tenantId: currentTenantId(),
    ttftMs: ctx.ttftMs,
  });
}

export function recordFlowExecutionSync(ctx: { flowId: string; taskId: string; startedAtMs: number; ok: boolean }): void {
  pushMetric({
    at: Date.now(),
    flowId: ctx.flowId,
    hadError: !ctx.ok,
    latencyMs: Math.max(0, Date.now() - ctx.startedAtMs),
    stream: false,
    taskId: ctx.taskId,
    tenantId: currentTenantId(),
  });
}

export interface ExecutionAggregateSlice {
  count: number;
  errors: number;
  avgLatencyMs: number;
  avgTtftMs?: number;
  avgApproxOutputChars?: number;
}

export interface ExecutionMetricsSnapshot {
  recentCount: number;
  byFlow: Record<string, ExecutionAggregateSlice>;
  byTenantId: Record<string, ExecutionAggregateSlice>;
}

interface Acc {
  count: number;
  err: number;
  sumLat: number;
  sumTtft: number;
  nTtft: number;
  sumChars: number;
  nChars: number;
}

function fold(acc: Record<string, Acc>, key: string, m: FlowRunMetric): void {
  const a = acc[key] ?? { count: 0, err: 0, nChars: 0, nTtft: 0, sumChars: 0, sumLat: 0, sumTtft: 0 };
  a.count += 1;
  if (m.hadError) {
    a.err += 1;
  }
  a.sumLat += m.latencyMs;
  if (m.ttftMs !== null && m.ttftMs !== undefined) {
    a.sumTtft += m.ttftMs;
    a.nTtft += 1;
  }
  if (m.approxOutputChars !== null && m.approxOutputChars !== undefined) {
    a.sumChars += m.approxOutputChars;
    a.nChars += 1;
  }
  acc[key] = a;
}

function toSlices(acc: Record<string, Acc>): Record<string, ExecutionAggregateSlice> {
  const o: Record<string, ExecutionAggregateSlice> = {};
  for (const [k, a] of Object.entries(acc)) {
    o[k] = {
      avgApproxOutputChars: a.nChars ? a.sumChars / a.nChars : undefined,
      avgLatencyMs: a.count ? a.sumLat / a.count : 0,
      avgTtftMs: a.nTtft ? a.sumTtft / a.nTtft : undefined,
      count: a.count,
      errors: a.err,
    };
  }
  return o;
}

export function getExecutionMetricsSnapshot(filterTenantId?: string | null): ExecutionMetricsSnapshot {
  const byFlow: Record<string, Acc> = {};
  const byTenantId: Record<string, Acc> = {};
  const ftid = filterTenantId?.trim() ?? "";
  const source = ftid ? recent.filter((m) => (m.tenantId?.trim() ?? "") === ftid) : recent;
  for (const m of source) {
    fold(byFlow, m.flowId, m);
    fold(byTenantId, m.tenantId?.trim() ? m.tenantId!.trim() : "_none", m);
  }
  return {
    byFlow: toSlices(byFlow),
    byTenantId: toSlices(byTenantId),
    recentCount: source.length,
  };
}

export function getExecutionMetricsRecent(filterTenantId?: string | null): FlowRunMetric[] {
  const ftid = filterTenantId?.trim() ?? "";
  if (!ftid) {
    return [...recent];
  }
  return recent.filter((m) => (m.tenantId?.trim() ?? "") === ftid);
}

export function resetExecutionMetricsForTests(): void {
  recent.length = 0;
}

import { currentTenantId } from '@cube-ai/tenant-context'

export type FlowRunMetric = {
  flowId: string
  taskId: string
  latencyMs: number
  stream: boolean
  hadError: boolean
  tenantId?: string | null
  ttftMs?: number
  approxOutputChars?: number
  at: number
}

const recent: FlowRunMetric[] = []
const MAX_RECENT = 2000

function pushMetric(m: FlowRunMetric): void {
  recent.push(m)
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT)
}

export function recordFlowExecutionFromSse(ctx: {
  flowId: string
  taskId: string
  startedAtMs: number
  hadError: boolean
  ttftMs?: number
  approxOutputChars?: number
}): void {
  pushMetric({
    flowId: ctx.flowId,
    taskId: ctx.taskId,
    latencyMs: Math.max(0, Date.now() - ctx.startedAtMs),
    stream: true,
    hadError: ctx.hadError,
    tenantId: currentTenantId(),
    ttftMs: ctx.ttftMs,
    approxOutputChars: ctx.approxOutputChars,
    at: Date.now(),
  })
}

export function recordFlowExecutionSync(ctx: {
  flowId: string
  taskId: string
  startedAtMs: number
  ok: boolean
}): void {
  pushMetric({
    flowId: ctx.flowId,
    taskId: ctx.taskId,
    latencyMs: Math.max(0, Date.now() - ctx.startedAtMs),
    stream: false,
    hadError: !ctx.ok,
    tenantId: currentTenantId(),
    at: Date.now(),
  })
}

export type ExecutionAggregateSlice = {
  count: number
  errors: number
  avgLatencyMs: number
  avgTtftMs?: number
  avgApproxOutputChars?: number
}

export type ExecutionMetricsSnapshot = {
  recentCount: number
  byFlow: Record<string, ExecutionAggregateSlice>
  byTenantId: Record<string, ExecutionAggregateSlice>
}

type Acc = {
  count: number
  err: number
  sumLat: number
  sumTtft: number
  nTtft: number
  sumChars: number
  nChars: number
}

function fold(acc: Record<string, Acc>, key: string, m: FlowRunMetric): void {
  const a = acc[key] ?? { count: 0, err: 0, sumLat: 0, sumTtft: 0, nTtft: 0, sumChars: 0, nChars: 0 }
  a.count += 1
  if (m.hadError) a.err += 1
  a.sumLat += m.latencyMs
  if (m.ttftMs != null) {
    a.sumTtft += m.ttftMs
    a.nTtft += 1
  }
  if (m.approxOutputChars != null) {
    a.sumChars += m.approxOutputChars
    a.nChars += 1
  }
  acc[key] = a
}

function toSlices(acc: Record<string, Acc>): Record<string, ExecutionAggregateSlice> {
  const o: Record<string, ExecutionAggregateSlice> = {}
  for (const [k, a] of Object.entries(acc)) {
    o[k] = {
      count: a.count,
      errors: a.err,
      avgLatencyMs: a.count ? a.sumLat / a.count : 0,
      avgTtftMs: a.nTtft ? a.sumTtft / a.nTtft : undefined,
      avgApproxOutputChars: a.nChars ? a.sumChars / a.nChars : undefined,
    }
  }
  return o
}

export function getExecutionMetricsSnapshot(filterTenantId?: string | null): ExecutionMetricsSnapshot {
  const byFlow: Record<string, Acc> = {}
  const byTenantId: Record<string, Acc> = {}
  const ftid = filterTenantId?.trim() ?? ''
  const source = ftid ? recent.filter((m) => (m.tenantId?.trim() ?? '') === ftid) : recent
  for (const m of source) {
    fold(byFlow, m.flowId, m)
    fold(byTenantId, m.tenantId?.trim() ? m.tenantId!.trim() : '_none', m)
  }
  return {
    recentCount: source.length,
    byFlow: toSlices(byFlow),
    byTenantId: toSlices(byTenantId),
  }
}

export function getExecutionMetricsRecent(filterTenantId?: string | null): FlowRunMetric[] {
  const ftid = filterTenantId?.trim() ?? ''
  if (!ftid) return [...recent]
  return recent.filter((m) => (m.tenantId?.trim() ?? '') === ftid)
}

export function resetExecutionMetricsForTests(): void {
  recent.length = 0
}

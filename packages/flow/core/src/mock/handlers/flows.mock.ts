import { normalizeRunBody } from '../../contracts/cube-run'
import { emptyCubeFlowGraph } from '../../contracts/cube-flow'
import { createSseResponse } from '../../http/sse-response'
import { encodeCubeSseEvent } from '../../langflow/build-event-mapper'
import { MockRegistry } from '@cube-ai/ai-center/platform/server-mock'

const iso = '2025-01-01T00:00:00.000Z'
const MOCK_FLOW_ID = '00000000-0000-4000-8000-000000000001'

function listItem(id: string, name: string) {
  return {
    id,
    name,
    description: 'mock',
    create_time: iso,
    update_time: iso,
    nodeCount: 0,
    bindingStatus: 'pending' as const,
    langflowFlowId: null as string | null,
  }
}

function flowDetail(
  id: string,
  name: string,
  binding: 'pending' | 'linked' | 'broken' = 'pending',
) {
  const graph = emptyCubeFlowGraph()
  return {
    id,
    name,
    description: 'mock flow',
    create_time: iso,
    update_time: iso,
    nodeCount: graph.nodes.length,
    bindingStatus: binding,
    langflowFlowId: binding === 'linked' ? 'mock-lf-flow-id' : null,
    graph,
  }
}

function sseForFlow(flowId: string, query: string): Response {
  const taskId = crypto.randomUUID()
  const traceId = taskId
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeCubeSseEvent({
          type: 'workflow_start',
          payload: { task_id: taskId, flow_id: flowId, trace_id: traceId, engine: 'mock-flows' },
        }),
      )
      controller.enqueue(
        encodeCubeSseEvent({ type: 'token', payload: { text: `[mock-flow] ${query.slice(0, 2000)}` } }),
      )
      controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }))
      controller.close()
    },
  })
  return createSseResponse(stream)
}

const reg = MockRegistry.getInstance()

reg.define('flows.list', false, () => [listItem(MOCK_FLOW_ID, 'Mock Flow')])

reg.define('flows.create', false, (_ctx, args) => {
  const body = (args[0] as { name?: string; description?: string }) ?? {}
  const name = body.name?.trim() || 'mock-created'
  const id = crypto.randomUUID()
  return flowDetail(id, name)
})

reg.define('flows.import', false, (_ctx, args) => {
  const raw = args[0]
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const ce = o['cubeFlowExport']
  const inner = ce && typeof ce === 'object' && !Array.isArray(ce) ? (ce as Record<string, unknown>) : null
  const name =
    (typeof o['name'] === 'string' && o['name'].trim()
      ? o['name'].trim()
      : typeof inner?.['name'] === 'string'
        ? inner['name'].trim()
        : 'imported') || 'imported'
  const id = crypto.randomUUID()
  return flowDetail(id, name, 'linked')
})

reg.define('flows.export', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  return {
    cubeFlowExport: {
      version: 1 as const,
      exportedAt: iso,
      name: `Flow ${id.slice(0, 8)}`,
      description: 'mock flow',
      graph: emptyCubeFlowGraph(),
    },
  }
})

reg.define('flows.importGraph', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  return flowDetail(id, `Flow ${id.slice(0, 8)}`, 'linked')
})

reg.define('flows.get', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  return flowDetail(id, `Flow ${id.slice(0, 8)}`)
})

reg.define('flows.update', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  const body = (args[1] as { name?: string; description?: string; graph?: unknown }) ?? {}
  const name = body.name?.trim() ?? 'mock-updated'
  return flowDetail(id, name, 'linked')
})

reg.define('flows.remove', false, () => ({ deleted: true as const }))

reg.define('flows.importLf', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  return flowDetail(id, `Imported ${id.slice(0, 8)}`, 'linked')
})

reg.define('flows.listPlaygroundSessions', false, () => [
  {
    id: 'mock-session-1',
    title: 'Default',
    isDefault: true,
    update_time: iso,
  },
])

reg.define('flows.createPlaygroundSession', false, () => ({
  id: `mock-session-${crypto.randomUUID()}`,
}))

reg.define('flows.getPlaygroundSessionMessages', false, () => [])

reg.define('flows.playgroundMessages', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  const norm = normalizeRunBody(args[1])
  if (norm.stream !== false) {
    return sseForFlow(id, norm.input ?? '')
  }
  return { status: 'ok' as const, raw: { mock: true, flow_id: id, message: norm.input ?? '' } }
})

reg.define('flows.run', false, (_ctx, args) => {
  const id = String(args[0] ?? MOCK_FLOW_ID)
  const rawBody = args[1]
  const bodyRec = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? (rawBody as Record<string, unknown>) : {}
  const streamFlag = bodyRec['stream'] === true
  const norm = normalizeRunBody(rawBody)
  if (streamFlag) {
    return sseForFlow(id, norm.input ?? '')
  }
  const taskId = crypto.randomUUID()
  return {
    status: 'ok' as const,
    raw: { mock: true, flow_id: id },
    task_id: taskId,
    trace_id: taskId,
  }
})

reg.define('flows.monitorTraces', false, () => ({ traces: [] as unknown[], total: 0, pages: 0 }))

reg.define('flows.monitorBuilds', false, () => ({ vertex_builds: {} as Record<string, unknown> }))

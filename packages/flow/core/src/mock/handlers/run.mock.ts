import { normalizeRunBody } from '../../contracts/cube-run'
import { createSseResponse } from '../../http/sse-response'
import { encodeCubeSseEvent } from '../../langflow/build-event-mapper'
import { MockRegistry } from '@cube-ai/server-mock'

function sseForFlow(flowId: string, query: string): Response {
  const taskId = crypto.randomUUID()
  const traceId = taskId
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeCubeSseEvent({
          type: 'workflow_start',
          payload: { task_id: taskId, flow_id: flowId, trace_id: traceId, engine: 'mock' },
        }),
      )
      controller.enqueue(
        encodeCubeSseEvent({ type: 'token', payload: { text: `[mock-run] ${query.slice(0, 2000)}` } }),
      )
      controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }))
      controller.close()
    },
  })
  return createSseResponse(stream)
}

MockRegistry.getInstance().define(
  'run.invoke',
  false,
  (_ctx, args) => {
    const flowId = String(args[0] ?? '')
    const body = args[1]
    const norm = normalizeRunBody(body)
    if (norm.stream !== false) {
      return sseForFlow(flowId, norm.input ?? '')
    }
    const taskId = crypto.randomUUID()
    return {
      status: 'ok' as const,
      raw: { mock: true, message: norm.input?.slice(0, 500) ?? '' },
      task_id: taskId,
      trace_id: taskId,
    }
  },
)

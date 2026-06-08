import type { Context } from '@dangao/bun-server'
import { createSseResponse } from '../../http/sse-response'
import { encodeCubeSseEvent } from '../../langflow/build-event-mapper'
import { MockRegistry } from '@cube-ai/server-mock'

function asRecord(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>
  return null
}

function webhookSse(flowId: string, query: string): Response {
  const taskId = crypto.randomUUID()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeCubeSseEvent({
          type: 'workflow_start',
          payload: { task_id: taskId, flow_id: flowId, engine: 'mock-webhook' },
        }),
      )
      controller.enqueue(
        encodeCubeSseEvent({ type: 'token', payload: { text: `[mock-webhook] ${query.slice(0, 2000)}` } }),
      )
      controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }))
      controller.close()
    },
  })
  return createSseResponse(stream)
}

MockRegistry.getInstance().define(
  'webhook.receive',
  false,
  async (_ctx, args) => {
    const flowId = String(args[0] ?? '')
    const ctx = args[1] as Context | undefined
    let input = ''
    if (ctx) {
      await ctx.getBody()
      try {
        const parsed = ctx.body ?? {}
        const o = asRecord(parsed) ?? {}
        input =
          typeof o['input'] === 'string'
            ? o['input']
            : typeof o['message'] === 'string'
              ? o['message']
              : typeof o['query'] === 'string'
                ? o['query']
                : ''
      } catch {
        /* ignore */
      }
    }
    return webhookSse(flowId, input)
  },
)

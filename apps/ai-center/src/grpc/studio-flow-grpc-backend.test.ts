import { describe, expect, test } from 'bun:test'
import type { FlowService } from '@cube-ai/flow-studio'
import { createStudioFlowGrpcBackend } from './studio-flow-grpc-backend'

describe('createStudioFlowGrpcBackend', () => {
  test('uploadFlowFile delegates using the studio flow id received from gRPC', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'test.png', { type: 'image/png' })
    const calls: Array<{ flowId: string; file: File }> = []
    const studio = {
      async uploadFlowFile(flowId: string, uploaded: File) {
        calls.push({ flowId, file: uploaded })
        return { id: 'img-1', name: uploaded.name, file_path: '/flow-files/img-1.png' }
      },
    } as unknown as FlowService

    const backend = createStudioFlowGrpcBackend(studio)
    const result = await backend.uploadFlowFile('854901549002915840', file)

    expect(calls).toEqual([{ flowId: '854901549002915840', file }])
    expect(result).toEqual({ id: 'img-1', name: 'test.png', file_path: '/flow-files/img-1.png' })
  })

  test('runFlow delegates using the studio flow id and gRPC execution body', async () => {
    const input = {
      query: 'describe image',
      files: [{ id: 'img-1', file_path: '/flow-files/img-1.png', mime: 'image/png' }],
    }
    const variables = { tone: 'short' }
    const calls: Array<{ flowId: string; body: unknown }> = []
    const studio = {
      async runFlow(flowId: string, body: unknown) {
        calls.push({ flowId, body })
        return { raw: { session_id: 'sess-1', outputs: [{ text: 'ok' }] } }
      },
    } as unknown as FlowService

    const backend = createStudioFlowGrpcBackend(studio)
    const result = await backend.runFlow('854901549002915840', { input, variables })

    expect(calls).toEqual([{ flowId: '854901549002915840', body: { input, variables } }])
    expect(result.raw?.session_id).toBe('sess-1')
  })
})

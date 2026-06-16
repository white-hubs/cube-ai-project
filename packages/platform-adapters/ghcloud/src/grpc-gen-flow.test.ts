import { describe, expect, test } from 'bun:test'
import { create } from '@bufbuild/protobuf'
import {
  FlowServiceGrpc,
  RunFlowRequestSchema,
  UploadFlowImageResponseSchema,
} from './index'

describe('flow gRPC stubs re-export', () => {
  test('FlowServiceGrpc exposes the 3 methods', () => {
    expect(FlowServiceGrpc.method.runFlow).toBeDefined()
    expect(FlowServiceGrpc.method.runFlowStream).toBeDefined()
    expect(FlowServiceGrpc.method.uploadFlowImage).toBeDefined()
  })

  test('schemas construct messages', () => {
    const req = create(RunFlowRequestSchema, { flowId: '1' })
    expect(req.flowId).toBe('1')
    const resp = create(UploadFlowImageResponseSchema, {})
    expect(resp).toBeDefined()
  })
})

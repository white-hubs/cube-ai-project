import { describe, test, expect } from 'bun:test'
import type { HandlerContext } from '@connectrpc/connect'
import { currentTenantId } from '@cube-ai/ai-center/platform/server-shared'
import { createFlowGrpcServiceImpl } from './flow-grpc.service'
import type { FlowGrpcBackend } from './flow-grpc-backend'

function makeHandlerContext(tenant: string): HandlerContext {
  return {
    requestHeader: new Headers({ tenant }),
    url: 'http://localhost:50051/guhecloud.cube.base.ai_application.flow.v1.FlowService/UploadFlowImage',
    requestMethod: 'POST',
    signal: new AbortController().signal,
    service: {} as HandlerContext['service'],
    method: {} as HandlerContext['method'],
    peer: { addr: '127.0.0.1', metadata: new Headers() },
    values: new Map(),
    abort: () => {},
  } as unknown as HandlerContext
}

describe('createFlowGrpcServiceImpl — tenant context', () => {
  test('uploadFlowImage populates tenantContextAls so currentTenantId() returns the tenant header', async () => {
    let capturedTenantId: string | null = 'NOT_SET'

    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        capturedTenantId = currentTenantId()
        return { id: 'img-id', name: 'test.png', file_path: '/tmp/test.png' }
      },
      async runFlow(_flowId, _body) {
        return {}
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend)
    await impl.uploadFlowImage!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.UploadFlowImageRequest' as never,
        flowId: '854901549002915840',
        image: {
          $typeName: 'guhecloud.cube.base.ai_application.flow.v1.FlowImageUploadPart' as never,
          content: new Uint8Array([1, 2, 3]),
          filename: 'test.png',
          contentType: 'image/png',
        },
      },
      makeHandlerContext('12345'),
    )

    expect(capturedTenantId).toBe('12345')
  })

  test('runFlow populates tenantContextAls so currentTenantId() returns the tenant header', async () => {
    let capturedTenantId: string | null = 'NOT_SET'

    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        return {}
      },
      async runFlow(_flowId, _body) {
        capturedTenantId = currentTenantId()
        return { raw: { session_id: 'sess-1', outputs: [] } }
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend)
    await impl.runFlow!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest' as never,
        flowId: '854901549002915840',
        input: 'hello',
        variables: {},
        images: [],
      },
      makeHandlerContext('99999'),
    )

    expect(capturedTenantId).toBe('99999')
  })

  test('uploadFlowImage without tenant header — currentTenantId() returns null', async () => {
    let capturedTenantId: string | null = 'NOT_SET'

    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        capturedTenantId = currentTenantId()
        return { id: 'img-id', name: 'test.png' }
      },
      async runFlow(_flowId, _body) {
        return {}
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend)
    await impl.uploadFlowImage!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.UploadFlowImageRequest' as never,
        flowId: 'flow-1',
        image: {
          $typeName: 'guhecloud.cube.base.ai_application.flow.v1.FlowImageUploadPart' as never,
          content: new Uint8Array([1]),
          filename: 'x.png',
          contentType: 'image/png',
        },
      },
      makeHandlerContext(''),
    )

    expect(capturedTenantId).toBeNull()
  })
})

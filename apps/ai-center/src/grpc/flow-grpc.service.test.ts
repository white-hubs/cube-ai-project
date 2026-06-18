import { describe, test, expect } from 'bun:test'
import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect'
import { BadRequestException, NotFoundException } from '@dangao/bun-server'
import { currentTenantId } from '@cube-ai/ai-center/platform/server-shared'
import { createFlowGrpcServiceImpl } from './flow-grpc.service'
import type { FlowGrpcBackend } from './flow-grpc-backend'

interface CapturedLog {
  fields: Record<string, unknown>
  msg: string
}

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

  test('runFlow logs grpc ingress start without request body fields', async () => {
    const logs: CapturedLog[] = []
    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        return {}
      },
      async runFlow(_flowId, _body) {
        return { raw: { session_id: 'sess-1', outputs: [] } }
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend, {
      logger: {
        info(fields: Record<string, unknown>, msg: string) {
          logs.push({ fields, msg })
        },
      },
    })

    await impl.runFlow!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest' as never,
        flowId: '854901549002915840',
        input: 'sensitive prompt',
        variables: {
          secret: 'do-not-log',
        },
        images: [],
      },
      makeHandlerContext('99999'),
    )

    expect(logs).toHaveLength(1)
    expect(logs[0]).toEqual({
      msg: 'flow grpc ingress start',
      fields: {
        event: 'flow.grpc.ingress.start',
        method: 'runFlow',
        flowId: '854901549002915840',
        tenantId: '99999',
        peer: '127.0.0.1',
      },
    })
    expect(logs[0]?.fields).not.toHaveProperty('input')
    expect(logs[0]?.fields).not.toHaveProperty('variables')
  })

  test('uploadFlowImage logs grpc ingress start without image content', async () => {
    const logs: CapturedLog[] = []
    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        return { id: 'img-id', name: 'secret.png', file_path: '/tmp/secret.png' }
      },
      async runFlow(_flowId, _body) {
        return {}
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend, {
      logger: {
        info(fields: Record<string, unknown>, msg: string) {
          logs.push({ fields, msg })
        },
      },
    })

    await impl.uploadFlowImage!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.UploadFlowImageRequest' as never,
        flowId: '854901549002915840',
        image: {
          $typeName: 'guhecloud.cube.base.ai_application.flow.v1.FlowImageUploadPart' as never,
          content: new Uint8Array([115, 101, 99, 114, 101, 116]),
          filename: 'secret.png',
          contentType: 'image/png',
        },
      },
      makeHandlerContext('99999'),
    )

    expect(logs).toHaveLength(1)
    expect(logs[0]).toEqual({
      msg: 'flow grpc ingress start',
      fields: {
        event: 'flow.grpc.ingress.start',
        method: 'uploadFlowImage',
        flowId: '854901549002915840',
        tenantId: '99999',
        peer: '127.0.0.1',
      },
    })
    expect(logs[0]?.fields).not.toHaveProperty('image')
    expect(logs[0]?.fields).not.toHaveProperty('content')
  })

  test('runFlowStream logs grpc ingress start without request body fields', async () => {
    const logs: CapturedLog[] = []
    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        return {}
      },
      async runFlow(_flowId, _body) {
        return {}
      },
      async runFlowStream(_flowId, _body) {
        return new Response('event: end\ndata: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        })
      },
    }

    const impl = createFlowGrpcServiceImpl(backend, {
      logger: {
        info(fields: Record<string, unknown>, msg: string) {
          logs.push({ fields, msg })
        },
      },
    })

    const stream = impl.runFlowStream!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest' as never,
        flowId: '854901549002915840',
        input: 'sensitive prompt',
        variables: {
          secret: 'do-not-log',
        },
        images: [],
      },
      makeHandlerContext('99999'),
    )

    for await (const _item of stream) {
      // consume the stream to exercise the Connect streaming handler path
    }

    expect(logs).toHaveLength(1)
    expect(logs[0]).toEqual({
      msg: 'flow grpc ingress start',
      fields: {
        event: 'flow.grpc.ingress.start',
        method: 'runFlowStream',
        flowId: '854901549002915840',
        tenantId: '99999',
        peer: '127.0.0.1',
      },
    })
    expect(logs[0]?.fields).not.toHaveProperty('input')
    expect(logs[0]?.fields).not.toHaveProperty('variables')
  })

  test('uploadFlowImage without tenant header fails before invoking the backend', async () => {
    let backendCalled = false

    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        backendCalled = true
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
    const promise = impl.uploadFlowImage!(
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

    await expect(promise).rejects.toBeInstanceOf(ConnectError)
    await expect(promise).rejects.toHaveProperty('code', Code.InvalidArgument)
    expect(backendCalled).toBe(false)
  })

  test('runFlow maps studio not-found errors to Connect NotFound', async () => {
    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        return {}
      },
      async runFlow(_flowId, _body) {
        throw new NotFoundException('流程不存在')
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend)
    const promise = impl.runFlow!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest' as never,
        flowId: '854901549002915840',
        input: 'hello',
        variables: {},
        images: [],
      },
      makeHandlerContext('12345'),
    )

    await expect(promise).rejects.toBeInstanceOf(ConnectError)
    await expect(promise).rejects.toHaveProperty('code', Code.NotFound)
  })

  test('runFlow maps studio bad-request errors to Connect InvalidArgument', async () => {
    const backend: FlowGrpcBackend = {
      async uploadFlowFile(_flowId, _file) {
        return {}
      },
      async runFlow(_flowId, _body) {
        throw new BadRequestException('流程尚未成功编译，无法执行')
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null)
      },
    }

    const impl = createFlowGrpcServiceImpl(backend)
    const promise = impl.runFlow!(
      {
        $typeName: 'guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest' as never,
        flowId: '854901549002915840',
        input: 'hello',
        variables: {},
        images: [],
      },
      makeHandlerContext('12345'),
    )

    await expect(promise).rejects.toBeInstanceOf(ConnectError)
    await expect(promise).rejects.toHaveProperty('code', Code.InvalidArgument)
  })
})

import { describe, expect, mock, test } from 'bun:test'
import { createHandlerContext } from '@connectrpc/connect'
import { FlowServiceGrpc } from '@cube-ai/platform-adapter-ghcloud'
import { ReadableStream } from 'node:stream/web'
import type { FlowRunBody } from './flow-grpc-backend'
import { createFlowGrpcServiceImpl } from './flow-grpc.service'

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

function testHandlerContext(
  method:
    | typeof FlowServiceGrpc.method.uploadFlowImage
    | typeof FlowServiceGrpc.method.runFlow
    | typeof FlowServiceGrpc.method.runFlowStream,
  init?: { tenant?: string },
): ReturnType<typeof createHandlerContext> {
  const headers = new Headers()
  if (init?.tenant != null) {
    headers.set('tenant', init.tenant)
  }
  return createHandlerContext({
    service: FlowServiceGrpc,
    method,
    protocolName: 'grpc',
    requestMethod: 'POST',
    url: 'http://127.0.0.1/grpc-test',
    requestHeader: headers,
  })
}

describe('flow grpc service', () => {
  test('runFlow maps request to FlowService and wraps response json payloads', async () => {
    const runFlow = mock(async (_flowId: string, _body: FlowRunBody) => ({
      raw: {
        session_id: 'session-1',
        outputs: [{ text: 'hello' }],
      },
    }))
    const service = createFlowGrpcServiceImpl({
      uploadFlowFile: mock(async () => ({ file_path: 'unused' })),
      runFlow,
      runFlowStream: mock(async () => new Response(null)),
    } as never)
    const runFlowHandler = service.runFlow!

    const result = await runFlowHandler(
      {
        flowId: '9001',
        input: 'hello',
        variables: { user: 'alice' },
      } as never,
      testHandlerContext(FlowServiceGrpc.method.runFlow, { tenant: '900001' }),
    )

    expect(runFlow).toHaveBeenCalledWith('9001', {
      input: 'hello',
      variables: { user: 'alice' },
    })
    expect(result.sessionId).toBe('session-1')
    expect(result.outputsJson).toBe(JSON.stringify([{ text: 'hello' }]))
    expect(result.rawJson).toBe(JSON.stringify({ session_id: 'session-1', outputs: [{ text: 'hello' }] }))
  })

  test('uploadFlowImage delegates image bytes to FlowService upload', async () => {
    const uploadedFiles: File[] = []
    const uploadFlowFile = mock(async (_flowId: string, file: File) => {
      uploadedFiles.push(file)
      return {
        flowId: 'remote-flow-1',
        file_path: 'remote-flow-1/image.png',
        name: 'image.png',
        mime: 'image/png',
        raw: { file_path: 'remote-flow-1/image.png' },
      }
    })
    const service = createFlowGrpcServiceImpl({
      uploadFlowFile,
      runFlow: mock(async () => ({ raw: {} })),
      runFlowStream: mock(async () => new Response(null)),
    } as never)
    const uploadHandler = service.uploadFlowImage!

    const result = await uploadHandler(
      {
        flowId: '9001',
        image: {
          content: new Uint8Array([1, 2, 3]),
          filename: 'image.png',
          contentType: 'image/png',
        },
      } as never,
      testHandlerContext(FlowServiceGrpc.method.uploadFlowImage, { tenant: '900001' }),
    )

    expect(uploadFlowFile).toHaveBeenCalled()
    const uploadedFile = uploadedFiles[0]
    if (!uploadedFile) {
      throw new Error('uploaded file was not captured')
    }
    expect(uploadedFile).toBeInstanceOf(File)
    expect(uploadedFile.name).toBe('image.png')
    expect(uploadedFile.type).toBe('image/png')
    expect(result.flowId).toBe('remote-flow-1')
    expect(result.image?.filePath).toBe('remote-flow-1/image.png')
    expect(result.image?.name).toBe('image.png')
    expect(result.image?.mime).toBe('image/png')
  })

  test('runFlow maps image refs into structured flow input files', async () => {
    const runFlow = mock(async (_flowId: string, _body: FlowRunBody) => ({ raw: {} }))
    const service = createFlowGrpcServiceImpl({
      uploadFlowFile: mock(async () => ({ file_path: 'unused' })),
      runFlow,
      runFlowStream: mock(async () => new Response(null)),
    } as never)
    const runFlowHandler = service.runFlow!

    await runFlowHandler(
      {
        flowId: '9001',
        input: 'describe image',
        images: [
          {
            filePath: 'remote-flow-1/image.png',
            name: 'image.png',
            mime: 'image/png',
          },
        ],
      } as never,
      testHandlerContext(FlowServiceGrpc.method.runFlow, { tenant: '900001' }),
    )

    expect(runFlow).toHaveBeenCalledWith('9001', {
      input: {
        query: 'describe image',
        files: [
          {
            filePath: 'remote-flow-1/image.png',
            file_path: 'remote-flow-1/image.png',
            path: 'remote-flow-1/image.png',
            name: 'image.png',
            mime: 'image/png',
          },
        ],
      },
    })
  })

  test('runFlowStream converts SSE frames into grpc stream events', async () => {
    const runFlowStream = mock(async () =>
      new Response(
        textStream([
          'event: message\nid: 1\ndata: {"chunk":"a"}\n\n',
          'event: end\ndata: [DONE]\n\n',
        ]) as unknown as BodyInit,
        {
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    )
    const service = createFlowGrpcServiceImpl({
      uploadFlowFile: mock(async () => ({ file_path: 'unused' })),
      runFlow: mock(async () => ({ raw: {} })),
      runFlowStream,
    } as never)
    const runFlowStreamHandler = service.runFlowStream!

    const events: Array<{ event?: string; id?: string; data?: string; done?: boolean }> = []
    for await (const item of runFlowStreamHandler(
      {
        flowId: '9002',
        input: 'stream me',
      } as never,
      testHandlerContext(FlowServiceGrpc.method.runFlowStream, { tenant: '900001' }),
    )) {
      events.push(item)
    }

    expect(runFlowStream).toHaveBeenCalledWith('9002', {
      input: 'stream me',
    })
    expect(
      events.map(({ event, id, data, done }) => ({
        event,
        id,
        data,
        done,
      })),
    ).toEqual([
      {
        event: 'message',
        id: '1',
        data: '{"chunk":"a"}',
        done: false,
      },
      {
        event: 'end',
        id: '',
        data: '[DONE]',
        done: true,
      },
    ])
  })
})

import { afterEach, describe, expect, test } from 'bun:test'
import { createClient } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { create } from '@bufbuild/protobuf'
import { FlowServiceGrpc, RunFlowRequestSchema, UploadFlowImageRequestSchema } from '@cube-ai/platform-adapter-ghcloud'
import { startFlowGrpcServer } from './flow-grpc-server'

describe('startFlowGrpcServer', () => {
  const servers: Array<{ close: () => Promise<void> }> = []

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()?.close()
    }
  })

  test('serves unary and server-streaming flow grpc methods', async () => {
    const server = await startFlowGrpcServer({
      hostname: '127.0.0.1',
      port: 0,
      flowService: {
        uploadFlowFile: async (flowId, file) => ({
          flowId,
          file_path: `${flowId}/${file.name}`,
          name: file.name,
          mime: file.type,
        }),
        runFlow: async (flowId, body) => ({
          raw: {
            session_id: `${flowId}-session`,
            outputs: [body.input ?? '', body.variables ?? {}],
          },
        }),
        runFlowStream: async (flowId, body) =>
          new Response(
            `event: token
id: ${flowId}-1
data: ${body.input ?? ''}

event: end
data: [DONE]

`,
            {
              headers: {
                'content-type': 'text/event-stream',
              },
            },
          ),
      },
    })
    servers.push(server)

    const transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${server.port}`,
    })
    const client = createClient(FlowServiceGrpc, transport)

    const uploadResponse = await client.uploadFlowImage(
      create(UploadFlowImageRequestSchema, {
        flowId: 'flow-1',
        image: {
          content: new Uint8Array([1, 2, 3]),
          filename: 'image.png',
          contentType: 'image/png',
        },
      }),
      { headers: { tenant: '900001' } },
    )

    expect(uploadResponse.image?.filePath).toBe('flow-1/image.png')

    const unaryResponse = await client.runFlow(
      create(RunFlowRequestSchema, {
        flowId: 'flow-1',
        input: 'hello',
        images: [uploadResponse.image!],
        variables: {
          name: 'cube',
        },
      }),
      { headers: { tenant: '900001' } },
    )

    expect(unaryResponse.sessionId).toBe('flow-1-session')
    expect(unaryResponse.outputsJson).toContain('hello')
    expect(unaryResponse.outputsJson).toContain('flow-1/image.png')

    const stream = client.runFlowStream(
      create(RunFlowRequestSchema, {
        flowId: 'flow-1',
        input: 'hello',
      }),
      { headers: { tenant: '900001' } },
    )

    const events: Array<{ event?: string; data?: string; done?: boolean }> = []
    for await (const item of stream) {
      events.push({
        event: item.event,
        data: item.data,
        done: item.done,
      })
    }

    expect(events).toEqual([
      {
        event: 'token',
        data: 'hello',
        done: false,
      },
      {
        event: 'end',
        data: '[DONE]',
        done: true,
      },
    ])
  })
})

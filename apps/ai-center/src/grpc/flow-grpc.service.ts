import { Code, ConnectError, type HandlerContext, type ServiceImpl } from '@connectrpc/connect'
import { create } from '@bufbuild/protobuf'
import {
  FlowServiceGrpc as FlowServiceGrpcDesc,
  FlowInputImageRefSchema,
  type FlowInputImageRef,
  type RunFlowRequest,
  type RunFlowResponse,
  type RunFlowStreamEvent,
  RunFlowResponseSchema,
  RunFlowStreamEventSchema,
  type UploadFlowImageRequest,
  type UploadFlowImageResponse,
  UploadFlowImageResponseSchema,
} from '@cube-ai/platform-adapter-ghcloud'
import { runWithConnectHandlerSession, streamWithConnectHandlerSession } from '@cube-ai/platform-adapter-ghcloud'
import type { FlowGrpcBackend, FlowRunBody, FlowUploadResultLike } from './flow-grpc-backend'

const FLOW_GRPC_LOG_PREFIX = '[FlowGrpc]'

export interface FlowGrpcServiceImplOptions {
  internalInvokeSecretKey?: string | null
}

function logFlowGrpcFailure(phase: string, detail: Record<string, unknown>, error: unknown): void {
  const base =
    error instanceof Error
      ? { message: error.message, stack: error.stack, cause: 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined }
      : { thrown: error }
  console.error(FLOW_GRPC_LOG_PREFIX, phase, 'failed', { ...detail, ...base })
}

function stringifyOrEmpty(value: unknown): string {
  return value == null ? '' : JSON.stringify(value)
}

function toExecutionFileRef(image: FlowInputImageRef): Record<string, unknown> {
  const filePath = image.filePath?.trim() ?? ''
  return {
    ...(image.id?.trim() ? { id: image.id.trim() } : {}),
    ...(image.name?.trim() ? { name: image.name.trim() } : {}),
    ...(filePath ? { filePath, file_path: filePath, path: filePath } : {}),
    ...(image.url?.trim() ? { url: image.url.trim() } : {}),
    ...(image.mime?.trim() ? { mime: image.mime.trim() } : {}),
    ...(image.ext && Object.keys(image.ext).length > 0 ? { ext: image.ext } : {}),
  }
}

function toFlowRunBody(request: Pick<RunFlowRequest, 'input' | 'variables' | 'images'>): FlowRunBody {
  const body: FlowRunBody = {}
  const images = Array.isArray(request.images) ? request.images : []
  if (typeof request.input === 'string' && request.input !== '') {
    body.input = images.length > 0
      ? {
          query: request.input,
          files: images.map(toExecutionFileRef),
        }
      : request.input
  } else if (images.length > 0) {
    body.input = {
      query: '',
      files: images.map(toExecutionFileRef),
    }
  }
  if (request.variables && Object.keys(request.variables).length > 0) {
    body.variables = request.variables
  }
  return body
}

function uploadedImageResponse(
  flowId: string,
  raw: FlowUploadResultLike,
): UploadFlowImageResponse {
  const filePath = raw.file_path ?? raw.filePath ?? raw.path ?? ''
  const image = create(FlowInputImageRefSchema, {
    id: raw.id ?? undefined,
    name: raw.name ?? undefined,
    filePath: filePath || undefined,
    url: raw.url ?? undefined,
    mime: raw.mime ?? undefined,
    ext: Object.fromEntries(
      Object.entries(raw.ext ?? {})
        .filter(([, value]) => value != null)
        .map(([key, value]) => [key, String(value)]),
    ),
  })
  return create(UploadFlowImageResponseSchema, {
    flowId: raw.flowId ?? flowId,
    image,
    rawJson: stringifyOrEmpty(raw.raw ?? raw),
  })
}

export async function* parseSseEvents(
  body: ReadableStream<Uint8Array> | null | undefined,
): AsyncIterable<RunFlowStreamEvent> {
  if (!body) {
    return
  }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const emitChunk = async function* (chunk: string): AsyncIterable<RunFlowStreamEvent> {
    const normalized = chunk.replace(/\r/g, '')
    const lines = normalized.split('\n')
    let event = ''
    let id = ''
    const dataLines: string[] = []
    for (const line of lines) {
      if (line === '' || line.startsWith(':')) {
        continue
      }
      if (line.startsWith('event:')) {
        event = line.slice(6).trim()
        continue
      }
      if (line.startsWith('id:')) {
        id = line.slice(3).trim()
        continue
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart())
      }
    }
    if (event === '' && id === '' && dataLines.length === 0) {
      return
    }
    const data = dataLines.join('\n')
    yield create(RunFlowStreamEventSchema, {
      event,
      id,
      data,
      done: event === 'end' || data === '[DONE]',
    })
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const boundary = buffer.indexOf('\n\n')
      if (boundary < 0) {
        break
      }
      const chunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      yield* emitChunk(chunk)
    }
  }

  buffer += decoder.decode()
  if (buffer.trim() !== '') {
    yield* emitChunk(buffer)
  }
}

export function createFlowGrpcServiceImpl(
  flowService: FlowGrpcBackend,
  options: FlowGrpcServiceImplOptions = {},
): Partial<ServiceImpl<typeof FlowServiceGrpcDesc>> {
  return {
    async uploadFlowImage(
      request: UploadFlowImageRequest,
      handlerContext: HandlerContext,
    ): Promise<UploadFlowImageResponse> {
      const flowId = String(request.flowId ?? '').trim()
      try {
        return await runWithConnectHandlerSession(handlerContext, async () => {
          const image = request.image
          if (!image || image.content.length === 0) {
            throw new ConnectError('image content is required', Code.InvalidArgument)
          }
          const filename = image.filename?.trim() || 'image'
          const file = new File([Uint8Array.from(image.content)], filename, {
            type: image.contentType?.trim() || 'application/octet-stream',
          })
          const uploaded = await flowService.uploadFlowFile(flowId, file)
          return uploadedImageResponse(flowId, uploaded)
        }, options)
      } catch (error) {
        logFlowGrpcFailure('uploadFlowImage', { flowId }, error)
        throw error
      }
    },
    async runFlow(request: RunFlowRequest, handlerContext: HandlerContext): Promise<RunFlowResponse> {
      const flowId = String(request.flowId ?? '').trim()
      try {
        return await runWithConnectHandlerSession(handlerContext, async () => {
          const result = await flowService.runFlow(flowId, toFlowRunBody(request))
          const raw = result.raw ?? {}
          return create(RunFlowResponseSchema, {
            sessionId: typeof raw.session_id === 'string' ? raw.session_id : '',
            outputsJson: stringifyOrEmpty(raw.outputs ?? []),
            rawJson: stringifyOrEmpty(raw),
          })
        }, options)
      } catch (error) {
        logFlowGrpcFailure('runFlow', { flowId }, error)
        throw error
      }
    },
    runFlowStream(request: RunFlowRequest, handlerContext: HandlerContext): AsyncIterable<RunFlowStreamEvent> {
      const flowId = String(request.flowId ?? '').trim()
      return streamWithConnectHandlerSession(handlerContext, () =>
        (async function* (): AsyncIterable<RunFlowStreamEvent> {
          try {
            const response = await flowService.runFlowStream(flowId, toFlowRunBody(request))
            yield* parseSseEvents(response.body)
          } catch (error) {
            logFlowGrpcFailure('runFlowStream', { flowId }, error)
            throw error
          }
        })(),
        options,
      )
    },
  }
}

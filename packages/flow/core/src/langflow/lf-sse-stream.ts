import {
  encodeCubeSseEvent,
  isLangflowAssistantAddMessage,
  mapLangflowBuildEnvelope,
  type CubeRunEvent,
} from './build-event-mapper'

type ParsedLfMessage = { dataJson: string; sseEvent?: string }

export type TransformLangflowSseOptions = {
  /** 并入每条 Cube SSE payload.ext */
  mergeRequestExt?: Record<string, unknown>
}

function parseSseBlock(block: string): ParsedLfMessage | null {
  const lines = block.split(/\r?\n/)
  const dataParts: string[] = []
  let sseEvent: string | undefined
  for (const line of lines) {
    if (line.startsWith('event:')) {
      sseEvent = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataParts.push(line.slice(5).trimStart())
    }
  }
  if (dataParts.length === 0) {
    const ev = sseEvent?.trim()
    if (ev === 'end' || ev === 'error') return { dataJson: '{}', sseEvent }
    return null
  }
  return { dataJson: dataParts.join('\n'), sseEvent }
}

function envelopeForMapper(dataObj: unknown, sseEvent?: string): unknown {
  const o = dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj) ? (dataObj as Record<string, unknown>) : null
  if (o && typeof o['event'] === 'string' && o['event'].length > 0) {
    return dataObj
  }
  const ev = sseEvent?.trim()
  if (ev && ev !== 'message') {
    return { event: ev, data: dataObj }
  }
  if (o && typeof o['chunk'] === 'string' && o['chunk'] !== '') {
    return { event: 'token', data: dataObj }
  }
  return dataObj
}

type LfStreamState = { sawLfEnd: boolean; sawStreamContent: boolean; sawToken: boolean }

function emitLangflowEnvelope(
  envelope: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
) {
  const pre = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? (envelope as Record<string, unknown>) : null
  const lfEv = typeof pre?.['event'] === 'string' ? pre['event'] : ''

  const cubes = mapLangflowBuildEnvelope(envelope)
  for (let cube of cubes) {
    if (cube.type === 'end' && lfEv === 'end_vertex' && !state.sawToken) {
      cube = {
        type: 'message_delta',
        payload: { phase: 'vertex_done', detail: pre?.['data'] },
      }
    }
    const assistantAddMessageAfterTokens =
      cube.type === 'message' &&
      lfEv === 'add_message' &&
      isLangflowAssistantAddMessage(pre?.['data']) &&
      state.sawToken

    if (cube.type === 'token') {
      state.sawToken = true
    }
    if (cube.type === 'token' || cube.type === 'message') {
      state.sawStreamContent = true
    }
    if (cube.type === 'end') state.sawLfEnd = true
    controller.enqueue(encodeCubeSseEvent(cube, mergeRequestExt))
    if (assistantAddMessageAfterTokens && !state.sawLfEnd) {
      state.sawLfEnd = true
      controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }, mergeRequestExt))
    }
  }
}

function emitBlock(
  block: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
) {
  const nl0 = block.indexOf('\n')
  if (nl0 > 0) {
    const head = block.slice(0, nl0).trim()
    if (head.startsWith('{')) {
      try {
        const o = JSON.parse(head) as { event?: string }
        if (typeof o?.event === 'string') {
          emitLangflowEnvelope(o, controller, state, mergeRequestExt)
          if (state.sawLfEnd) return
          const rest = block.slice(nl0 + 1)
          if (rest.trim()) emitBlock(rest, controller, state, mergeRequestExt)
          return
        }
      } catch {
        /* fall through */
      }
    }
  }
  const parsed = parseSseBlock(block)
  if (!parsed) return
  let envelope: unknown
  try {
    envelope = JSON.parse(parsed.dataJson) as unknown
  } catch {
    return
  }
  envelope = envelopeForMapper(envelope, parsed.sseEvent)
  emitLangflowEnvelope(envelope, controller, state, mergeRequestExt)
}

function blockLooksLikeSse(block: string): boolean {
  for (const line of block.split(/\r?\n/)) {
    const t = line.trimStart()
    if (t.startsWith('event:') || t.startsWith('data:')) return true
  }
  return false
}

type LfDrainAction = { kind: 'sse'; block: string } | { kind: 'env'; envelope: unknown } | { kind: 'skip' }

function nextLfPayload(buffer: string): { rest: string; action: LfDrainAction } | null {
  const iLf = buffer.indexOf('\n\n')
  const iCrLf = buffer.indexOf('\r\n\r\n')
  const hasSseDelim = iLf >= 0 || iCrLf >= 0
  if (hasSseDelim) {
    const useCrLf = iCrLf >= 0 && (iLf < 0 || iCrLf < iLf)
    const delimStart = useCrLf ? iCrLf : iLf
    const delimLen = useCrLf ? 4 : 2
    const block = buffer.slice(0, delimStart)
    const after = buffer.slice(delimStart + delimLen)
    if (blockLooksLikeSse(block)) {
      return { rest: after, action: { kind: 'sse', block } }
    }
    const firstLine = block.split(/\r?\n/)[0]?.trim() ?? ''
    if (firstLine.startsWith('{')) {
      try {
        const o = JSON.parse(firstLine) as { event?: string }
        if (typeof o?.event === 'string') {
          return { rest: after, action: { kind: 'env', envelope: o } }
        }
      } catch {
        /* fall through */
      }
    }
    return { rest: after, action: { kind: 'skip' } }
  }

  const nl = buffer.indexOf('\n')
  if (nl < 0) return null
  const line = buffer.slice(0, nl).replace(/\r$/, '').trim()
  const afterNl = buffer.slice(nl + 1)
  if (!line.startsWith('{')) return null
  try {
    const o = JSON.parse(line) as { event?: string }
    if (typeof o?.event === 'string') {
      return { rest: afterNl, action: { kind: 'env', envelope: o } }
    }
  } catch {
    return null
  }
  return null
}

function drainLfBuffer(
  bufferRef: { buf: string },
  controller: ReadableStreamDefaultController<Uint8Array>,
  lfState: LfStreamState,
  mergeRequestExt?: Record<string, unknown>,
) {
  for (;;) {
    const next = nextLfPayload(bufferRef.buf)
    if (!next) break
    bufferRef.buf = next.rest
    const a = next.action
    if (a.kind === 'skip') continue
    if (a.kind === 'sse') emitBlock(a.block, controller, lfState, mergeRequestExt)
    else emitLangflowEnvelope(a.envelope, controller, lfState, mergeRequestExt)
    if (lfState.sawLfEnd) break
  }
}

export function transformLangflowSseToCube(
  lfBody: ReadableStream<Uint8Array>,
  options?: TransformLangflowSseOptions,
): ReadableStream<Uint8Array> {
  const mergeRequestExt = options?.mergeRequestExt
  const upstream = lfBody.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const lfState = { sawLfEnd: false, sawStreamContent: false, sawToken: false }

  return new ReadableStream({
    async start(controller) {
      const drain = () => {
        const ref = { buf: buffer }
        drainLfBuffer(ref, controller, lfState, mergeRequestExt)
        buffer = ref.buf
      }

      try {
        for (;;) {
          drain()
          if (lfState.sawLfEnd) {
            void upstream.cancel()
            break
          }

          const { done, value } = await upstream.read()
          if (done) {
            drain()
            if (buffer.trim()) {
              const t = buffer.trim()
              if (t.startsWith('{')) {
                try {
                  const o = JSON.parse(t) as { event?: string }
                  if (typeof o?.event === 'string') emitLangflowEnvelope(o, controller, lfState, mergeRequestExt)
                  else emitBlock(buffer, controller, lfState, mergeRequestExt)
                } catch {
                  emitBlock(buffer, controller, lfState, mergeRequestExt)
                }
              } else {
                emitBlock(buffer, controller, lfState, mergeRequestExt)
              }
            }
            if (!lfState.sawLfEnd) {
              controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }, mergeRequestExt))
            }
            break
          }

          buffer += decoder.decode(value, { stream: true })
          drain()
          if (lfState.sawLfEnd) {
            void upstream.cancel()
            break
          }
        }
      } catch {
        if (!lfState.sawLfEnd) {
          try {
            controller.enqueue(encodeCubeSseEvent({ type: 'end', payload: {} }, mergeRequestExt))
          } catch {
            /* ignore */
          }
        }
      } finally {
        await Promise.resolve()
        try {
          controller.close()
        } catch {
          /* ignore */
        }
        upstream.cancel().catch(() => {})
      }
    },
    cancel() {
      void upstream.cancel()
    },
  })
}

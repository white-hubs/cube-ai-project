/**
 * Tee Cube Playground SSE to persist bot reply while forwarding to client.
 * Format matches encodeCubeSseEvent / web consumeCubeSseStream.
 */

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let eventName = 'message'
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }
  if (dataLines.length === 0) return null
  const joined = dataLines.join('\n')
  try {
    return { event: eventName, data: JSON.parse(joined) as unknown }
  } catch {
    return null
  }
}

function takeNextCubeFrame(buf: string): { block: string; rest: string } | null {
  const iLf = buf.indexOf('\n\n')
  const iCrLf = buf.indexOf('\r\n\r\n')
  if (iLf < 0 && iCrLf < 0) return null
  const useCrLf = iCrLf >= 0 && (iLf < 0 || iCrLf < iLf)
  if (useCrLf) {
    return { block: buf.slice(0, iCrLf), rest: buf.slice(iCrLf + 4) }
  }
  return { block: buf.slice(0, iLf), rest: buf.slice(iLf + 2) }
}

function applyCubeEvent(acc: string, event: string, data: unknown): string {
  if (event === 'token') {
    const o = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
    const t = o && typeof o['text'] === 'string' ? o['text'] : null
    if (t) return acc + t
    return acc
  }
  if (event === 'message') {
    const o = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
    if (o && typeof o['text'] === 'string') return o['text']
    if (o && typeof o['content'] === 'string') return o['content']
    return acc
  }
  if (event === 'error') {
    const o = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
    const m = o && typeof o['message'] === 'string' ? o['message'] : null
    return m ?? acc
  }
  return acc
}

export async function drainCubeSseAccumulatePlaygroundReply(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let acc = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const next = takeNextCubeFrame(buffer)
        if (!next) break
        buffer = next.rest
        const parsed = parseSseBlock(next.block)
        if (parsed) acc = applyCubeEvent(acc, parsed.event, parsed.data)
      }
    }
    if (buffer.trim()) {
      const parsed = parseSseBlock(buffer)
      if (parsed) acc = applyCubeEvent(acc, parsed.event, parsed.data)
    }
  } finally {
    reader.releaseLock()
  }
  return acc
}

export function teeCubeSseWithPersistence(
  source: ReadableStream<Uint8Array>,
  onPlaygroundReplyComplete: (text: string) => void | Promise<void>,
): ReadableStream<Uint8Array> {
  const [clientBranch, persistBranch] = source.tee()
  void (async () => {
    try {
      const text = await drainCubeSseAccumulatePlaygroundReply(persistBranch)
      await onPlaygroundReplyComplete(text)
    } catch (e) {
      console.error('[cube-ai] playground SSE persistence tap failed', e)
    }
  })()
  return clientBranch
}

import { describe, expect, test } from 'bun:test'
import { transformLangflowSseToCube } from './lf-sse-stream'

function chunks(s: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(s))
      controller.close()
    },
  })
}

describe('lf-sse-stream', () => {
  test('transforms CRLF-delimited LF frames (no bare \\n\\n in stream)', async () => {
    const lf =
      'data: {"event":"token","data":{"chunk":"x"}}\r\n\r\n' +
      'data: {"event":"end","data":{}}\r\n\r\n'
    const out = transformLangflowSseToCube(chunks(lf))
    const reader = out.getReader()
    const dec = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      all += dec.decode(value)
    }
    expect(all).toContain('event: token')
    expect(all).toContain('event: end')
  })

  test('NDJSON: assistant add_message after token triggers synthetic end', async () => {
    const lf =
      '{"event":"add_message","data":{"text":"user","sender":"User"}}\n' +
      '{"event":"token","data":{"chunk":"hi"}}\n' +
      '{"event":"add_message","data":{"text":"full","sender":"Machine"}}\n'
    const out = transformLangflowSseToCube(chunks(lf))
    const reader = out.getReader()
    const dec = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      all += dec.decode(value)
    }
    expect(all).toContain('event: token')
    expect(all).toContain('event: end')
    const endMatches = all.split('event: end').length - 1
    expect(endMatches).toBe(1)
  })

  test('NDJSON: early terminal end_vertex is not flow end; later one closes after tokens', async () => {
    const lf =
      '{"event":"end_vertex","data":{"build_data":{"next_vertices_ids":[]}}}\n' +
      '{"event":"token","data":{"chunk":"hi"}}\n' +
      '{"event":"end_vertex","data":{"build_data":{"next_vertices_ids":[]}}}\n'
    const out = transformLangflowSseToCube(chunks(lf))
    const reader = out.getReader()
    const dec = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      all += dec.decode(value)
    }
    expect(all).toContain('event: message_delta')
    expect(all).toContain('event: token')
    expect(all).toContain('"text":"hi"')
    const endMatches = all.split('event: end').length - 1
    expect(endMatches).toBe(1)
  })

  test('Langflow docs style: NDJSON lines (single \\n between events)', async () => {
    const lf =
      '{"event":"token","data":{"chunk":"hi"}}\n' +
      '{"event":"end","data":{}}\n'
    const out = transformLangflowSseToCube(chunks(lf))
    const reader = out.getReader()
    const dec = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      all += dec.decode(value)
    }
    expect(all).toContain('event: token')
    expect(all).toContain('"text":"hi"')
    expect(all).toContain('event: end')
  })

  test('LF Playground: SSE event line + flat data payload (no inner event field)', async () => {
    const lf =
      'event: token\ndata: {"chunk":"hi","session_id":"s1"}\n\n' +
      'event: end\ndata: {}\n\n'
    const out = transformLangflowSseToCube(chunks(lf))
    const reader = out.getReader()
    const dec = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      all += dec.decode(value)
    }
    expect(all).toContain('event: token')
    expect(all).toContain('"text":"hi"')
    expect(all).toContain('event: end')
  })

  test('transforms Langflow-style data lines to cube events', async () => {
    const lf =
      'event: message\ndata: {"event":"token","data":{"chunk":"ab"}}\n\n' +
      'data: {"event":"end","data":{}}\n\n'
    const out = transformLangflowSseToCube(chunks(lf))
    const reader = out.getReader()
    const dec = new TextDecoder()
    let all = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      all += dec.decode(value)
    }
    expect(all).toContain('event: token')
    expect(all).toContain('"text":"ab"')
    expect(all).toContain('event: end')
  })
})

import { describe, expect, test } from 'bun:test'
import { OverlapTextChunker } from './overlap-text.chunker'

describe('OverlapTextChunker', () => {
  test('packs adjacent paragraphs with preferred separators before length fallback', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 12,
      chunkOverlap: 4,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "3",
      text: 'alpha\n\nbeta\n\ngamma',
      sourceType: 'md',
      fileName: 'paragraphs.md',
      tenantId: '1',
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.text).toBe('alpha\n\nbeta')
    expect(chunks[1]?.text).toBe('gamma')
  })

  test('cleans whitespace and removes urls and emails before splitting', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 100,
      chunkOverlap: 10,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "4",
      text: '  Hello   world  \n\nvisit https://example.com or mail me@example.com  \n\n next\tline ',
      sourceType: 'txt',
      fileName: 'clean.txt',
      tenantId: '2',
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('Hello world\n\nvisit or mail\n\nnext line')
  })

  test('uses line separators before overlap fallback inside oversized paragraphs', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 12,
      chunkOverlap: 4,
    })

    const chunks = await chunker.chunkDocument({
      documentId: '5',
      text: 'line-one\nline-two\nline-three',
      sourceType: 'txt',
      fileName: 'lines.txt',
      tenantId: '3',
    })

    expect(chunks).toHaveLength(3)
    expect(chunks.map((chunk) => chunk.text)).toEqual(['line-one', 'line-two', 'line-three'])
  })

  test('supports custom separator passed by user', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 8,
      chunkOverlap: 0,
    })

    const chunks = await chunker.chunkDocument({
      documentId: 6,
      text: 'alpha###beta###gamma',
      sourceType: 'txt',
      fileName: 'custom-separator.txt',
      tenantId: '3',
      chunkingOptions: {
        separator: '###',
      } as never,
    } as never)

    expect(chunks).toHaveLength(3)
    expect(chunks.map((chunk) => chunk.text)).toEqual(['alpha', 'beta', 'gamma'])
  })

  test('keeps heading blocks intact in block mode', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 256,
      chunkOverlap: 20,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "8",
      text: [
        '### 指令 1',
        '',
        `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`,
        '',
        '### 指令 2',
        '',
        `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`,
      ].join('\n'),
      sourceType: 'txt',
      fileName: 'sdk.txt',
      tenantId: '1',
      chunkingOptions: {
        textChunkMode: 'block',
      } as never,
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.text).toContain('### 指令 1')
    expect(chunks[0]?.text).toContain('changeModelTime')
    expect(chunks[1]?.text).toContain('### 指令 2')
    expect(chunks[1]?.text).toContain('changeModelWeather')
  })

  test('auto-detects block mode for structured instruction lists', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 256,
      chunkOverlap: 20,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "9",
      text: [
        '### 指令 1',
        '',
        `切换模型时间 { action: 'changeModelTime' params: { value: 'day' } }`,
        '',
        '### 指令 2',
        '',
        `切换模型天气 { action: 'changeModelWeather' params: { value: 'Sunny' } }`,
      ].join('\n'),
      sourceType: 'txt',
      fileName: 'sdk.txt',
      tenantId: '1',
      chunkingOptions: {
        textChunkMode: 'auto',
      } as never,
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.text).toContain('### 指令 1')
    expect(chunks[1]?.text).toContain('### 指令 2')
  })

  test('merge mode can still combine short structured paragraphs', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 256,
      chunkOverlap: 20,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "10",
      text: '- line one\n\n- line two',
      sourceType: 'txt',
      fileName: 'list.txt',
      tenantId: '1',
      chunkingOptions: {
        textChunkMode: 'merge',
      } as never,
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('- line one\n\n- line two')
  })

  test('splits long text with overlap and preserves order', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 12,
      chunkOverlap: 4,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "7",
      text: 'abcdefghijklmnopqrstuvwx',
      sourceType: 'txt',
      fileName: 'demo.txt',
      tenantId: '9',
    })

    expect(chunks).toHaveLength(3)
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2])
    expect(chunks[0]?.text).toBe('abcdefghijkl')
    expect(chunks[1]?.text).toBe('ijklmnopqrst')
    expect(chunks[2]?.text).toBe('qrstuvwx')
    expect(chunks[1]?.documentId).toBe('7')
    expect(chunks[1]?.tenantId).toBe('9')
  })

  test('returns one chunk for short text', async () => {
    const chunker = new OverlapTextChunker({
      chunkSize: 50,
      chunkOverlap: 10,
    })

    const chunks = await chunker.chunkDocument({
      documentId: "1",
      text: 'short text',
      sourceType: 'md',
      fileName: 'note.md',
      tenantId: null,
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.text).toBe('short text')
  })
})

import { describe, expect, test } from 'bun:test'
import { createOverlapTextChunker } from './ingestion.module'
import { OverlapTextChunker } from './chunkers/overlap-text.chunker'

describe('createOverlapTextChunker', () => {
  test('returns an OverlapTextChunker instance synchronously', () => {
    const chunker = createOverlapTextChunker({
      ingestionChunkSize: 128,
      ingestionChunkOverlap: 16,
    })

    expect(chunker).toBeInstanceOf(OverlapTextChunker)
  })
})

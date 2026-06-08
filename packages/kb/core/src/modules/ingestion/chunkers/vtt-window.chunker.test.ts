import { describe, expect, test } from 'bun:test'
import { VttWindowChunker } from './vtt-window.chunker'

describe('VttWindowChunker', () => {
  test('maps cues to chunks with times and keywords', () => {
    const c = new VttWindowChunker()
    const out = c.chunk('demo.vtt', [
      { cueIndex: 0, startTime: '0:00', endTime: '0:01', text: 'hello world' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.displayText).toContain('0:00')
    expect(out[0]!.keywords).toEqual(['hello', 'world'])
    expect(out[0]!.chunkType).toBe('vtt-cue-window')
  })
})

import { describe, expect, test } from 'bun:test'
import { normalizeRunBody } from './cube-run'

describe('normalizeRunBody', () => {
  test('v1 string input and tweaks', () => {
    const n = normalizeRunBody({
      input: 'hi',
      tweaks: { n1: { k: 1 } },
      stream: true,
    })
    expect(n.input).toBe('hi')
    expect(n.tweaks?.['n1']).toEqual({ k: 1 })
    expect(n.stream).toBe(true)
  })

  test('v2 structured input merges params into tweaks', () => {
    const n = normalizeRunBody({
      input: {
        query: 'q',
        params: { nodeA: { temperature: 0.1 } },
      },
      tweaks: { nodeA: { model: 'x' } },
    })
    expect(n.input).toBe('q')
    expect(n.tweaks?.['nodeA']).toEqual(expect.objectContaining({ temperature: 0.1, model: 'x' }))
  })

  test('v2 structured input preserves uploaded file refs for ChatInput injection', () => {
    const n = normalizeRunBody({
      input: {
        query: 'describe image',
        files: [
          { file_path: 'flow-1/2026-05-22_image.png', name: 'image.png', mime: 'image/png' },
          { path: 'flow-1/2026-05-22_second.jpg', name: 'second.jpg' },
        ],
      },
    })

    expect(n.input).toBe('describe image')
    expect(n.input_files).toEqual([
      { file_path: 'flow-1/2026-05-22_image.png', name: 'image.png', mime: 'image/png' },
      { path: 'flow-1/2026-05-22_second.jpg', name: 'second.jpg' },
    ])
  })

  test('user_context and runtime_config passthrough', () => {
    const n = normalizeRunBody({
      input: '',
      user_context: { user_id: 'u1' },
      runtime_config: { max_iterations: 3 },
    })
    expect(n.user_context.user_id).toBe('u1')
    expect(n.runtime_config.max_iterations).toBe(3)
  })

  test('top-level stream propagates to runtime_config when missing', () => {
    const n = normalizeRunBody({ input: 'x', stream: false })
    expect(n.stream).toBe(false)
  })
})

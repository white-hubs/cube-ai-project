import { describe, expect, test } from 'bun:test'
import { PropertiesGroupChunker } from './properties-group.chunker'

describe('PropertiesGroupChunker', () => {
  test('groups keys by inferred namespace', () => {
    const ch = new PropertiesGroupChunker()
    const chunks = ch.chunk('app.properties', [
      { key: 'db.host', value: 'localhost' },
      { key: 'db.port', value: '5432' },
      { key: 'other', value: 'x' },
    ])
    const ns = new Set(chunks.map((c) => c.propertyNamespace))
    expect(ns.has('db')).toBe(true)
    expect(chunks.every((c) => c.chunkType === 'properties-group')).toBe(true)
  })
})

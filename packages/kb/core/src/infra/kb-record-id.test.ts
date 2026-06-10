import { describe, expect, test } from 'bun:test'
import { generateKbRecordId, resolveKbRecordId } from './kb-record-id'

describe('generateKbRecordId', () => {
  test('generates 19-digit decimal strings', () => {
    const id = generateKbRecordId()
    expect(id).toMatch(/^\d{19}$/)
  })

  test('resolveKbRecordId preserves explicit id', () => {
    expect(resolveKbRecordId('2063877629778944002')).toBe('2063877629778944002')
  })

  test('resolveKbRecordId generates when missing', () => {
    expect(resolveKbRecordId(undefined)).toMatch(/^\d{19}$/)
  })
})

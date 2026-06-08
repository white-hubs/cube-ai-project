import { describe, expect, test } from 'bun:test'
import {
  buildEdgePortData,
  dedupeFieldOrderNames,
  dedupeSchemaInputsByName,
  isConnectionOnlyInputType,
  orderInputsByFieldOrder,
  parseX6PortId,
  portTypesCompatible,
  pruneMcpToolsNonTemplateConfigKeys,
  sanitizeFieldOrderForTemplate,
  toolMetadataActionLabels,
  x6InputPortId,
  x6OutputPortId,
} from './cube-component-schema'

describe('cube-component-schema', () => {
  test('isConnectionOnlyInputType', () => {
    expect(isConnectionOnlyInputType('HandleInput')).toBe(true)
    expect(isConnectionOnlyInputType('StrInput')).toBe(false)
  })

  test('dedupeSchemaInputsByName and dedupeFieldOrderNames', () => {
    expect(dedupeSchemaInputsByName([{ name: 'a' }, { name: 'a' }, { name: 'b' }])).toEqual([
      { name: 'a' },
      { name: 'b' },
    ])
    expect(dedupeFieldOrderNames(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  test('orderInputsByFieldOrder', () => {
    const inputs = [{ name: 'c' }, { name: 'a' }, { name: 'b' }]
    expect(orderInputsByFieldOrder(inputs, ['b', 'a'])).toEqual([{ name: 'b' }, { name: 'a' }, { name: 'c' }])
  })

  test('sanitizeFieldOrderForTemplate', () => {
    const tpl = { foo: { name: 'bar' }, code: 'x' }
    expect(sanitizeFieldOrderForTemplate(['foo', 'missing', 'foo'], tpl)).toEqual(['foo'])
    expect(sanitizeFieldOrderForTemplate(['a', 'a'], null)).toEqual(['a'])
  })

  test('x6 port ids', () => {
    expect(x6InputPortId('x')).toBe('i:x')
    expect(x6OutputPortId('y')).toBe('o:y')
    expect(parseX6PortId('i:a')).toEqual({ kind: 'in', logical: 'a' })
    expect(parseX6PortId('o:b')).toEqual({ kind: 'out', logical: 'b' })
    expect(parseX6PortId('bad')).toBeNull()
  })

  test('portTypesCompatible', () => {
    expect(portTypesCompatible([], ['A'])).toBe(true)
    expect(portTypesCompatible(['A'], [])).toBe(true)
    expect(portTypesCompatible(['A', 'B'], ['B'])).toBe(true)
    expect(portTypesCompatible(['A'], ['C'])).toBe(false)
  })

  test('buildEdgePortData', () => {
    expect(buildEdgePortData('s', 'out', 't', 'in')).toEqual({
      cubeSourcePort: 'cube.sp/o/s/out',
      cubeTargetPort: 'cube.sp/i/t/in',
    })
  })

  test('pruneMcpToolsNonTemplateConfigKeys', () => {
    const next = pruneMcpToolsNonTemplateConfigKeys({
      tool: 'x',
      extra: 1,
      code: 'c',
      tools_metadata: [],
    })
    expect(next).toEqual({ tool: 'x', code: 'c', tools_metadata: [] })
    expect(next['extra']).toBeUndefined()
  })

  test('toolMetadataActionLabels humanizes slug-like display_name', () => {
    const labels = toolMetadataActionLabels([
      { name: 'build_output', display_name: 'BUILD_OUTPUT' },
    ])
    expect(labels[0]).toContain('Build')
  })
})

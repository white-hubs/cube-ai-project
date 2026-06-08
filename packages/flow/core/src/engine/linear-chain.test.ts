import { describe, expect, test } from 'bun:test'
import { HttpException } from '@dangao/bun-server'
import type { CubeFlowGraph, CubeFlowNode } from '../contracts/cube-flow'
import { CUBE_FLOW_SCHEMA_VERSION } from '../contracts/cube-flow'
import {
  isChatInputLfKey,
  isLlmLfKey,
  lfKeyFromCubeType,
  resolveLinearExecutionChain,
} from './linear-chain'

function node(partial: Partial<CubeFlowNode> & Pick<CubeFlowNode, 'id' | 'cubeType'>): CubeFlowNode {
  return {
    lfNodeId: partial.id,
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    config: {},
    ...partial,
  }
}

function graph(nodes: CubeFlowNode[], edges: CubeFlowGraph['edges']): CubeFlowGraph {
  return { schemaVersion: CUBE_FLOW_SCHEMA_VERSION, nodes, edges }
}

describe('linear-chain', () => {
  test('lfKeyFromCubeType strips cube.lf.', () => {
    expect(lfKeyFromCubeType('cube.lf.ChatInput')).toBe('ChatInput')
    expect(lfKeyFromCubeType('X')).toBe('X')
  })

  test('isChatInputLfKey and isLlmLfKey', () => {
    expect(isChatInputLfKey('ChatInput')).toBe(true)
    expect(isLlmLfKey('OpenAIModel')).toBe(true)
    expect(isLlmLfKey('FooLanguageModelBar')).toBe(true)
  })

  test('resolveLinearExecutionChain single path', () => {
    const g = graph(
      [node({ id: 'a', cubeType: 'cube.lf.ChatInput' }), node({ id: 'b', cubeType: 'cube.lf.OpenAIModel' })],
      [
        {
          id: 'e1',
          source: 'a',
          target: 'b',
          sourcePort: 'o:x',
          targetPort: 'i:y',
        },
      ],
    )
    const chain = resolveLinearExecutionChain(g)
    expect(chain.map((n) => n.id)).toEqual(['a', 'b'])
  })

  test('reject zero or multiple sources', () => {
    const two = graph(
      [node({ id: 'a', cubeType: 'x' }), node({ id: 'b', cubeType: 'y' })],
      [],
    )
    expect(() => resolveLinearExecutionChain(two)).toThrow(HttpException)

    const merged = graph(
      [node({ id: 'a', cubeType: 'x' }), node({ id: 'b', cubeType: 'y' }), node({ id: 'c', cubeType: 'z' })],
      [
        { id: '1', source: 'a', target: 'c', sourcePort: 'o', targetPort: 'i' },
        { id: '2', source: 'b', target: 'c', sourcePort: 'o', targetPort: 'i' },
      ],
    )
    expect(() => resolveLinearExecutionChain(merged)).toThrow(HttpException)
  })

  test('reject branch and cycle', () => {
    const branch = graph(
      [node({ id: 'a', cubeType: 'x' }), node({ id: 'b', cubeType: 'y' }), node({ id: 'c', cubeType: 'z' })],
      [
        { id: '1', source: 'a', target: 'b', sourcePort: 'o', targetPort: 'i' },
        { id: '2', source: 'a', target: 'c', sourcePort: 'o', targetPort: 'i' },
      ],
    )
    expect(() => resolveLinearExecutionChain(branch)).toThrow(HttpException)

    const cycle = graph(
      [node({ id: 'a', cubeType: 'x' }), node({ id: 'b', cubeType: 'y' })],
      [
        { id: '1', source: 'a', target: 'b', sourcePort: 'o', targetPort: 'i' },
        { id: '2', source: 'b', target: 'a', sourcePort: 'o', targetPort: 'i' },
      ],
    )
    expect(() => resolveLinearExecutionChain(cycle)).toThrow(HttpException)
  })

  test('invalid edge target', () => {
    const g = graph([node({ id: 'a', cubeType: 'x' })], [
      { id: '1', source: 'a', target: 'missing', sourcePort: 'o', targetPort: 'i' },
    ])
    expect(() => resolveLinearExecutionChain(g)).toThrow(HttpException)
  })
})

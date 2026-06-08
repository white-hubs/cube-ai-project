import { HttpException } from '@dangao/bun-server'
import type { CubeFlowGraph, CubeFlowNode } from '../contracts/cube-flow'

/** Cube 引擎 MVP：单一入边链（无分支、无合流）。 */
export function resolveLinearExecutionChain(g: CubeFlowGraph): CubeFlowNode[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]))
  const inDeg = new Map<string, number>()
  for (const n of g.nodes) inDeg.set(n.id, 0)
  for (const e of g.edges) {
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1)
  }
  const sources = g.nodes.filter((n) => (inDeg.get(n.id) ?? 0) === 0)
  if (sources.length !== 1) {
    throw new HttpException(422, 'Cube engine MVP requires exactly one graph source node', {
      code: 'CUBE_ENGINE_UNSUPPORTED_GRAPH',
    })
  }
  const chain: CubeFlowNode[] = []
  let cur: CubeFlowNode | undefined = sources[0]
  const visited = new Set<string>()
  while (cur) {
    if (visited.has(cur.id)) {
      throw new HttpException(422, 'Cube engine detected a cycle', { code: 'CUBE_ENGINE_INVALID_GRAPH' })
    }
    visited.add(cur.id)
    chain.push(cur)
    const outs = g.edges.filter((e) => e.source === cur!.id)
    if (outs.length === 0) break
    if (outs.length > 1) {
      throw new HttpException(422, 'Cube engine MVP does not support branches', {
        code: 'CUBE_ENGINE_UNSUPPORTED_GRAPH',
      })
    }
    const nextId = outs[0]?.target
    cur = nextId ? byId.get(nextId) : undefined
    if (nextId && !cur) {
      throw new HttpException(422, 'Invalid graph edge target', { code: 'CUBE_ENGINE_INVALID_GRAPH' })
    }
  }
  return chain
}

export function lfKeyFromCubeType(cubeType: string): string {
  if (cubeType.startsWith('cube.lf.')) return cubeType.slice('cube.lf.'.length)
  return cubeType
}

export function isChatInputLfKey(lfKey: string): boolean {
  return lfKey === 'ChatInput'
}

export function isLlmLfKey(lfKey: string): boolean {
  return (
    lfKey === 'AIMLModel' ||
    lfKey === 'OpenAIModel' ||
    lfKey.includes('ChatOpenAI') ||
    lfKey.includes('LanguageModel')
  )
}

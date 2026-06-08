/** Langflow ReactFlow edges use JSON with ASCII quotes replaced by U+0153 (œ). */

const Q = '\u0153'

export type LfSourceHandleObj = {
  dataType: string
  id: string
  name: string
  output_types: string[]
}

export type LfTargetHandleObj = {
  fieldName: string
  id: string
  inputTypes: string[]
  type: string
}

export function stringifyLfHandle(obj: object): string {
  return JSON.stringify(obj).replace(/"/g, Q)
}

export function parseLfHandleString(s: string): unknown {
  const normalized = s.replace(new RegExp(Q, 'g'), '"')
  return JSON.parse(normalized) as unknown
}

export function isSourceHandleObj(x: unknown): x is LfSourceHandleObj {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.dataType === 'string' &&
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    Array.isArray(o.output_types)
  )
}

export function isTargetHandleObj(x: unknown): x is LfTargetHandleObj {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return (
    typeof o.fieldName === 'string' &&
    typeof o.id === 'string' &&
    Array.isArray(o.inputTypes) &&
    typeof o.type === 'string'
  )
}

/** Cube semantic ports (protocol v1). */
export function semanticSourcePort(nodeId: string, outputName: string): string {
  return `cube.sp/o/${nodeId}/${outputName}`
}

export function semanticTargetPort(nodeId: string, fieldName: string): string {
  return `cube.sp/i/${nodeId}/${fieldName}`
}

export function parseSemanticSourcePort(p: string): { nodeId: string; outputName: string } | null {
  // 与 web `cube-graph-bridge` 一致：输出名允许多段（含 `/`），避免与客户端解析不一致导致边被丢弃
  const m = /^cube\.sp\/o\/([^/]+)\/(.+)$/.exec(p)
  if (!m) return null
  return { nodeId: m[1]!, outputName: m[2]! }
}

export function parseSemanticTargetPort(p: string): { nodeId: string; fieldName: string } | null {
  const m = /^cube\.sp\/i\/([^/]+)\/(.+)$/.exec(p)
  if (!m) return null
  return { nodeId: m[1]!, fieldName: m[2]! }
}

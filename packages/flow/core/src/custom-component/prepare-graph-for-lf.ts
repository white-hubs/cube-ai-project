import {
  CUBE_CUSTOM_COMPONENT_DSL_KEY,
  CUBE_LF_CODE_OPAQUE_KEY,
} from '../shared-imports/cube-component-schema'
import type { CubeFlowGraph } from '../contracts/cube-flow'
import { compileCustomComponentDslV2 } from './compile-v2'
import { detectCustomDslVersion } from './dsl.schema'
import { transpileCustomComponentDsl } from './transpile'

function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T
}

/**
 * 转义层入口：在合并进执行后端 flow 文档之前，将 Cube DSL / 导入不透明副本转为合并所需的运行时源码字段（内存中的 `config.code`）。
 * 不修改入参；返回新图副本供下游合并器使用。
 */
export function prepareCubeGraphLangflowExport(graph: CubeFlowGraph): CubeFlowGraph {
  const out = deepClone(graph)
  for (const n of out.nodes) {
    if (n.cubeType !== 'cube.lf.CustomComponent') continue
    const cfg = { ...n.config } as Record<string, unknown>
    const dslRaw = cfg[CUBE_CUSTOM_COMPONENT_DSL_KEY]
    if (dslRaw != null && String(dslRaw).trim() !== '') {
      let parsed: unknown
      if (typeof dslRaw === 'string') {
        try {
          parsed = JSON.parse(dslRaw) as unknown
        } catch (e) {
          throw new CubeCustomComponentPrepareError(
            `节点 ${n.lfNodeId} 的 ${CUBE_CUSTOM_COMPONENT_DSL_KEY} 不是合法 JSON：${e instanceof Error ? e.message : String(e)}`,
          )
        }
      } else {
        parsed = dslRaw
      }
      try {
        const code =
          detectCustomDslVersion(parsed) === 2
            ? compileCustomComponentDslV2(parsed)
            : transpileCustomComponentDsl(parsed)
        cfg['code'] = code
      } catch (e) {
        throw new CubeCustomComponentPrepareError(
          `节点 ${n.lfNodeId} 的 ${CUBE_CUSTOM_COMPONENT_DSL_KEY} 编译失败：${e instanceof Error ? e.message : String(e)}`,
        )
      }
      n.config = cfg
      continue
    }
    const opaque = cfg[CUBE_LF_CODE_OPAQUE_KEY]
    if (typeof opaque === 'string' && opaque.length > 0) {
      cfg['code'] = opaque
      n.config = cfg
    }
  }
  return out
}

export class CubeCustomComponentPrepareError extends Error {
  readonly code = 'CUSTOM_COMPONENT_PREPARE_FAILED' as const
  constructor(message: string) {
    super(message)
    this.name = 'CubeCustomComponentPrepareError'
  }
}

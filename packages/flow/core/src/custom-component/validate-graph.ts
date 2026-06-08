import { BadRequestException } from '@dangao/bun-server'
import { CUBE_CUSTOM_COMPONENT_DSL_KEY, CUBE_LF_CODE_OPAQUE_KEY } from '../shared-imports/cube-component-schema'
import type { CubeFlowGraph } from '../contracts/cube-flow'
import { safeParseCubeCustomComponentDslV2 } from './dsl-v2.schema'
import { detectCustomDslVersion, safeParseCubeCustomComponentDsl } from './dsl.schema'

const MAX_DSL_JSON_BYTES = 512 * 1024

export function validateCubeCustomComponentGraph(graph: CubeFlowGraph): void {
  for (const n of graph.nodes) {
    if (n.cubeType !== 'cube.lf.CustomComponent') continue
    if (n.config['code'] != null) {
      throw new BadRequestException(
        `Node ${n.lfNodeId}: 不可将可执行源码存入 config.code；请使用 ${CUBE_CUSTOM_COMPONENT_DSL_KEY} 或导入派生的 ${CUBE_LF_CODE_OPAQUE_KEY}`,
        { code: 'CUSTOM_COMPONENT_CODE_FORBIDDEN' },
      )
    }
    const raw = n.config[CUBE_CUSTOM_COMPONENT_DSL_KEY]
    if (raw == null || raw === '') continue
    const str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    if (Buffer.byteLength(str, 'utf8') > MAX_DSL_JSON_BYTES) {
      throw new BadRequestException(
        `${CUBE_CUSTOM_COMPONENT_DSL_KEY} exceeds max size (${MAX_DSL_JSON_BYTES} bytes) on node ${n.lfNodeId}`,
        { code: 'CUSTOM_COMPONENT_DSL_TOO_LARGE' },
      )
    }
    let parsed: unknown
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw) as unknown
      } catch {
        throw new BadRequestException(
          `Invalid JSON in ${CUBE_CUSTOM_COMPONENT_DSL_KEY} on node ${n.lfNodeId}`,
          { code: 'CUSTOM_COMPONENT_DSL_INVALID_JSON' },
        )
      }
    } else {
      parsed = raw
    }
    const r =
      detectCustomDslVersion(parsed) === 2
        ? safeParseCubeCustomComponentDslV2(parsed)
        : safeParseCubeCustomComponentDsl(parsed)
    if (!r.success) {
      const detail = r.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')
      throw new BadRequestException(
        `${CUBE_CUSTOM_COMPONENT_DSL_KEY} invalid on node ${n.lfNodeId}: ${detail}`,
        { code: 'CUSTOM_COMPONENT_DSL_SCHEMA' },
      )
    }
  }
}

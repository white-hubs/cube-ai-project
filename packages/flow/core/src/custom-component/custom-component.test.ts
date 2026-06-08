import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { makeMockAppConfig } from '../test-helpers/mock-app-config'
import {
  CUBE_CUSTOM_COMPONENT_DSL_KEY,
  CUBE_LF_CODE_OPAQUE_KEY,
} from '../shared-imports/cube-component-schema'
import { ComponentSchemaService } from '../components/component-schema.service'
import { emptyCubeFlowGraph } from '../contracts/cube-flow'
import { validateCubeCustomComponentGraph } from './validate-graph'
import {
  CubeCustomComponentPrepareError,
  prepareCubeGraphLangflowExport,
} from './prepare-graph-for-lf'
import { normalizeLfCode, extractLfTemplateCodeGoldens } from './lf-code-golden'
import {
  defaultCustomComponentIdentityDsl,
  transpileCustomComponentDsl,
  transpileParsedDsl,
} from './transpile'
import { roughPythonBraceBalance } from './static-check'

import { flowCoreFixturePaths } from '../test-helpers/fixture-paths'

const apiAllPath = flowCoreFixturePaths.apiAllPath

describe('custom-component / transpile', () => {
  test('identity DSL matches api-all CustomComponent golden', () => {
    const goldens = extractLfTemplateCodeGoldens(apiAllPath)
    const expected = goldens.get('CustomComponent')
    expect(expected).toBeDefined()
    const out = transpileParsedDsl(defaultCustomComponentIdentityDsl())
    expect(normalizeLfCode(out)).toBe(normalizeLfCode(expected!))
  })

  test('roughPythonBraceBalance passes on transpiled output', () => {
    const out = transpileParsedDsl(defaultCustomComponentIdentityDsl())
    expect(roughPythonBraceBalance(out).ok).toBe(true)
  })

  test('wrap_build_in_try emits try/except', () => {
    const dsl = defaultCustomComponentIdentityDsl()
    dsl.metadata.wrap_build_in_try = true
    const out = transpileParsedDsl(dsl)
    expect(out).toContain('try:')
    expect(out).toContain('except Exception')
  })

  test('http_request step pulls requests pip path via listPipForDsl', () => {
    const dsl = structuredClone(defaultCustomComponentIdentityDsl())
    dsl.steps = [{ action: 'http_request', params: { url: '{{input_value}}', method: 'GET' } }]
    const out = transpileCustomComponentDsl(dsl)
    expect(out).toContain('import requests')
    expect(out).toContain('requests.request')
  })

  test('message output fills Langflow required Message fields', () => {
    const dsl = structuredClone(defaultCustomComponentIdentityDsl())
    dsl.output = {
      kind: 'message',
      method: 'build_output',
      display_name: 'Output',
      name: 'output',
    }

    const out = transpileParsedDsl(dsl)

    expect(out).toContain(
      'msg = _cube_message_value if isinstance(_cube_message_value, Message) else Message(text=str(_cube_message_value) if _cube_message_value is not None else "", sender="Machine", sender_name="AI")',
    )
    expect(out).toContain('if getattr(msg, "text", None) is None:')
    expect(out).toContain('if not getattr(msg, "sender", None):')
    expect(out).toContain('if not getattr(msg, "sender_name", None):')
  })
})

describe('custom-component / prepare + validate', () => {
  test('prepare injects config.code from cube_dsl (in-memory)', () => {
    const g = emptyCubeFlowGraph()
    g.nodes.push({
      id: 'n1',
      lfNodeId: 'lf1',
      cubeType: 'cube.lf.CustomComponent',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      config: { [CUBE_CUSTOM_COMPONENT_DSL_KEY]: JSON.stringify(defaultCustomComponentIdentityDsl()) },
    })
    const p = prepareCubeGraphLangflowExport(g)
    expect(typeof p.nodes[0]!.config['code']).toBe('string')
    expect((p.nodes[0]!.config['code'] as string).length).toBeGreaterThan(10)
    expect(g.nodes[0]!.config['code']).toBeUndefined()
  })

  test('DSL wins over opaque when both set', () => {
    const goldens = extractLfTemplateCodeGoldens(apiAllPath)
    const opaque = goldens.get('CustomComponent') ?? 'opaque'
    const g = emptyCubeFlowGraph()
    g.nodes.push({
      id: 'n1',
      lfNodeId: 'lf1',
      cubeType: 'cube.lf.CustomComponent',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      config: {
        [CUBE_CUSTOM_COMPONENT_DSL_KEY]: JSON.stringify(defaultCustomComponentIdentityDsl()),
        [CUBE_LF_CODE_OPAQUE_KEY]: opaque,
      },
    })
    const p = prepareCubeGraphLangflowExport(g)
    expect(normalizeLfCode(p.nodes[0]!.config['code'] as string)).toBe(
      normalizeLfCode(transpileParsedDsl(defaultCustomComponentIdentityDsl())),
    )
  })

  test('prepare throws on invalid JSON in cube_dsl', () => {
    const g = emptyCubeFlowGraph()
    g.nodes.push({
      id: 'n1',
      lfNodeId: 'lf1',
      cubeType: 'cube.lf.CustomComponent',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      config: { [CUBE_CUSTOM_COMPONENT_DSL_KEY]: '{not json' },
    })
    expect(() => prepareCubeGraphLangflowExport(g)).toThrow(CubeCustomComponentPrepareError)
  })

  test('validate rejects persisted config.code', () => {
    const g = emptyCubeFlowGraph()
    g.nodes.push({
      id: 'n1',
      lfNodeId: 'lf1',
      cubeType: 'cube.lf.CustomComponent',
      x: 0,
      y: 0,
      width: 200,
      height: 80,
      config: { code: 'x=1' },
    })
    expect(() => validateCubeCustomComponentGraph(g)).toThrow()
  })
})

describe('custom-component / schema', () => {
  test('CustomComponent schema exposes Cube DSL field, not runtime source in inputs', () => {
    const svc = new ComponentSchemaService(
      makeMockAppConfig({
        paths: {
          langflowApiAllPath: apiAllPath,
          componentCatalogPath: '/app/data/cube-component-catalog.json',
          sqlitePath: '/app/data/cube-ai.sqlite',
        },
      }),
    )
    const s = svc.getSchemaForCubeType('cube.lf.CustomComponent')
    const names = s.inputs.map((i) => i.name)
    expect(names.includes(CUBE_CUSTOM_COMPONENT_DSL_KEY)).toBe(true)
    expect(names.includes('code')).toBe(false)
  })
})

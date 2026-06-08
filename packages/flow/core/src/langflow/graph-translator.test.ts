import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CubeFlowGraph } from '../contracts/cube-flow'
import {
  AGENT_LLM_CONNECT_OTHER,
  CUBE_CUSTOM_COMPONENT_DSL_KEY,
  CUBE_LF_CODE_OPAQUE_KEY,
  CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY,
  semanticSourcePort,
  semanticTargetPort,
} from '../shared-imports/cube-component-schema'
import { prepareCubeGraphLangflowExport } from '../custom-component/prepare-graph-for-lf'
import {
  cubeGraphToLfFlowData,
  injectLfMcpToolsDynamicSlotsFromListedTools,
  lfFlowDocumentToCubeGraph,
  normalizeCubeGraphMcpDynamicSchema,
  normalizeLoadFromDbInlineLiteralsDeep,
  normalizeMcpServerValueForFlowExport,
  reconcileMcpToolsToolsetTemplateInLfData,
} from './graph-translator'
import { clearLfApiAllCaches, getLfComponentDef } from './lf-api-all-registry'

import { flowCoreFixturePaths } from '../test-helpers/fixture-paths'

const goldenPath = flowCoreFixturePaths.goldenFlowPath
const promptGoldenPath = flowCoreFixturePaths.promptGoldenFlowPath
const apiAllPath = flowCoreFixturePaths.apiAllPath

describe('graph-translator', () => {
  test('cube -> lf: Smart Router syncs dynamic outputs so category_* sourceHandle gets output_types (LF cleanEdges)', () => {
    clearLfApiAllCaches()
    const srDef = getLfComponentDef('SmartRouter', apiAllPath)
    expect(srDef).toBeTruthy()
    expect((srDef as Record<string, unknown>)['outputs']).toEqual([])

    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const routes = [{ route_category: 'RouteA', route_description: '', output_value: '' }]
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'sr',
          lfNodeId: 'lf-sr',
          cubeType: 'cube.lf.SmartRouter',
          x: 0,
          y: 0,
          width: 280,
          height: 160,
          config: { routes, enable_else_output: false },
        },
        {
          id: 'om',
          lfNodeId: 'lf-om',
          cubeType: 'cube.lf.OpenAIModel',
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'sr',
          target: 'om',
          sourcePort: semanticSourcePort('lf-sr', 'category_1_result'),
          targetPort: semanticTargetPort('lf-om', 'system_message'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const srNode = nodes.find((n) => n['id'] === 'lf-sr')
    expect(srNode).toBeTruthy()
    const srData0 = srNode!['data'] as Record<string, unknown>
    expect(srData0['selected_output']).toBe('category_1_result')
    const srInner = srData0['node'] as Record<string, unknown>
    const outs = srInner['outputs'] as Array<Record<string, unknown>>
    expect(outs.length).toBe(1)
    expect(outs[0]!['name']).toBe('category_1_result')
    expect(outs[0]!['types']).toEqual(['Message'])

    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges.length).toBe(1)
    const d = edges[0]!['data'] as Record<string, unknown>
    const sh = d['sourceHandle'] as Record<string, unknown>
    expect(sh['name']).toBe('category_1_result')
    expect(sh['output_types']).toEqual(['Message'])
    expect(sh['dataType']).toBe('SmartRouter')
  })

  test('cube -> lf: Smart Router multi outgoing omits selected_output so LF cleanEdges keeps all handles', () => {
    clearLfApiAllCaches()
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const routes = [
      { route_category: 'TEST', route_description: '', output_value: '' },
      { route_category: '托尔斯泰', route_description: '', output_value: '' },
    ]
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'sr',
          lfNodeId: 'lf-sr',
          cubeType: 'cube.lf.SmartRouter',
          x: 0,
          y: 0,
          width: 280,
          height: 160,
          config: { routes, enable_else_output: false },
        },
        {
          id: 'om1',
          lfNodeId: 'lf-om1',
          cubeType: 'cube.lf.OpenAIModel',
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          config: {},
        },
        {
          id: 'ag',
          lfNodeId: 'lf-ag',
          cubeType: 'cube.lf.Agent',
          x: 400,
          y: 220,
          width: 320,
          height: 200,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'sr',
          target: 'om1',
          sourcePort: semanticSourcePort('lf-sr', 'category_1_result'),
          targetPort: semanticTargetPort('lf-om1', 'input'),
        },
        {
          id: 'e2',
          source: 'sr',
          target: 'ag',
          sourcePort: semanticSourcePort('lf-sr', 'category_2_result'),
          targetPort: semanticTargetPort('lf-ag', 'input'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const srNode = nodes.find((n) => n['id'] === 'lf-sr')
    const srData = srNode!['data'] as Record<string, unknown>
    expect(srData['selected_output']).toBeUndefined()

    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges.length).toBe(2)
    const names = edges.map(
      (ed) => ((ed['data'] as Record<string, unknown>)['sourceHandle'] as Record<string, unknown>)['name'],
    )
    expect(names.sort()).toEqual(['category_1_result', 'category_2_result'])
  })

  test('cube -> lf: Smart Router normalizes non-canonical source port name (e.g. route label slug) for sourceHandle', () => {
    clearLfApiAllCaches()
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const routes = [{ route_category: 'TEST', route_description: '', output_value: '' }]
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'sr',
          lfNodeId: 'lf-sr',
          cubeType: 'cube.lf.SmartRouter',
          x: 0,
          y: 0,
          width: 280,
          height: 160,
          config: { routes, enable_else_output: false },
        },
        {
          id: 'om',
          lfNodeId: 'lf-om',
          cubeType: 'cube.lf.OpenAIModel',
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'sr',
          target: 'om',
          sourcePort: semanticSourcePort('lf-sr', 'test'),
          targetPort: semanticTargetPort('lf-om', 'system_message'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges.length).toBe(1)
    const sh = (edges[0]!['data'] as Record<string, unknown>)['sourceHandle'] as Record<string, unknown>
    expect(sh['name']).toBe('category_1_result')
    expect(sh['output_types']).toEqual(['Message'])
  })

  test('cube -> lf: edge to Prompt dynamic var fills targetHandle inputTypes from merged template', () => {
    clearLfApiAllCaches()
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'n-chat',
          lfNodeId: 'n-chat',
          cubeType: 'cube.lf.ChatInput',
          x: 0,
          y: 0,
          width: 240,
          height: 120,
          config: {},
        },
        {
          id: 'n-prompt',
          lfNodeId: 'n-prompt',
          cubeType: 'cube.lf.Prompt Template',
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          config: { template: 'Hello {var1}' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n-chat',
          target: 'n-prompt',
          sourcePort: semanticSourcePort('n-chat', 'message'),
          targetPort: semanticTargetPort('n-prompt', 'var1'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges.length).toBe(1)
    const d = edges[0]!['data'] as Record<string, unknown>
    const tgt = d['targetHandle'] as Record<string, unknown>
    expect(tgt['fieldName']).toBe('var1')
    expect(tgt['inputTypes']).toEqual(['Message'])
    expect(tgt['type']).toBe('str')
  })

  test('lf -> cube -> lf preserves Prompt template, custom_fields, and object template values', () => {
    const raw = JSON.parse(readFileSync(promptGoldenPath, 'utf-8')) as Record<string, unknown>
    const data = raw['data'] as Record<string, unknown>
    const cube = lfFlowDocumentToCubeGraph(raw)
    expect(cube.nodes.length).toBe(1)
    const n = cube.nodes[0]!
    expect(n.cubeType).toBe('cube.lf.Prompt Template')
    expect(n.config['template']).toBe('Use {context} to answer {user_question}.')
    expect(n.customFields).toEqual({
      template: ['context', 'user_question'],
    })

    const merged = cubeGraphToLfFlowData(cube, data)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const ln = nodes[0]!
    const inner = (ln['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    expect(inner['custom_fields']).toEqual({
      template: ['context', 'user_question'],
    })
    const tpl = inner['template'] as Record<string, unknown>
    const slot = tpl['template'] as Record<string, unknown>
    expect(slot['value']).toBe('Use {context} to answer {user_question}.')
    const ctx = tpl['context'] as Record<string, unknown>
    const uq = tpl['user_question'] as Record<string, unknown>
    expect(ctx['_input_type']).toBe('DefaultPromptField')
    expect(uq['_input_type']).toBe('DefaultPromptField')
    expect(ctx['input_types']).toEqual(['Message'])
    expect(inner['field_order']).toEqual(['template', 'context', 'user_question', 'tool_placeholder'])
  })

  test('templateToConfig preserves dict-shaped slot values', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'n1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'n1',
              type: 'Fake',
              node: {
                template: {
                  _type: 'Component',
                  meta: {
                    _input_type: 'DictInput',
                    name: 'meta',
                    type: 'dict',
                    value: { a: 1, b: 'two' },
                  },
                },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    expect(cube.nodes[0]!.config['meta']).toEqual({ a: 1, b: 'two' })
  })

  test('cube -> lf: CustomComponent prepared from DSL rebuilds template (search_query not input_value stub)', () => {
    clearLfApiAllCaches()
    const dsl = {
      dslVersion: 1,
      metadata: {
        name: 'CustomApiSearch',
        display_name: 'Custom API Search',
        description: '使用自定义 API 进行知识库搜索',
      },
      inputs: [
        {
          kind: 'message_text',
          name: 'search_query',
          display_name: 'Search query',
          tool_mode: true,
        },
        { kind: 'str', name: 'api_url', display_name: 'API URL', required: true },
      ],
      output: {
        kind: 'data',
        name: 'out',
        display_name: 'Output',
        method: 'build_output',
      },
      steps: [],
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: 'c1',
          cubeType: 'cube.lf.CustomComponent',
          x: 0,
          y: 0,
          width: 280,
          height: 200,
          config: { [CUBE_CUSTOM_COMPONENT_DSL_KEY]: dsl },
        },
      ],
      edges: [],
    }
    const prepared = prepareCubeGraphLangflowExport(cube)
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const merged = cubeGraphToLfFlowData(prepared, base, (k) => getLfComponentDef(k, apiAllPath), apiAllPath)
    const nodes = merged['nodes'] as unknown[]
    expect(nodes.length).toBe(1)
    const lfNode = nodes[0] as Record<string, unknown>
    const inner = (lfNode['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['search_query']).toBeDefined()
    expect(tpl['input_value']).toBeUndefined()
    expect((tpl['search_query'] as Record<string, unknown>)['name']).toBe('search_query')
    expect(tpl['api_url']).toBeDefined()
    const outs = inner['outputs'] as Record<string, unknown>[]
    expect(outs.some((o) => o['name'] === 'out')).toBe(true)
  })

  test('cube -> lf: CustomComponent DSL v2 HandleInput keeps Message target handle types', () => {
    clearLfApiAllCaches()
    const dsl = {
      dslVersion: 2,
      metadata: {
        name: 'AiApplicationMultimodalMessageMerge',
        display_name: 'AI Application Multimodal Message Merge',
        wrap_build_in_try: true,
      },
      inputs: [
        { kind: 'message_text', name: 'text', display_name: 'Text', default: '', tool_mode: true },
        {
          kind: 'handle',
          name: 'original_message',
          display_name: 'Original Message',
          input_types: ['Message'],
          required: true,
        },
      ],
      output: {
        kind: 'message',
        method: 'build_output',
        display_name: 'Message',
        name: 'message',
        value_from: 'merged_message',
      },
      workflow: {
        blocks: [
          {
            type: 'op',
            action: 'message_merge',
            params: { text: '{{text}}', message: '{{original_message}}' },
            output_as: 'merged_message',
          },
        ],
      },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'chat',
          lfNodeId: 'ChatInput-chat',
          cubeType: 'cube.lf.ChatInput',
          x: 0,
          y: 0,
          width: 271,
          height: 92,
          config: {},
        },
        {
          id: 'merge',
          lfNodeId: 'CustomComponent-merge',
          cubeType: 'cube.lf.CustomComponent',
          x: 240,
          y: 0,
          width: 240,
          height: 112,
          config: { [CUBE_CUSTOM_COMPONENT_DSL_KEY]: dsl },
        },
      ],
      edges: [
        {
          id: 'e-original',
          source: 'chat',
          target: 'merge',
          sourcePort: semanticSourcePort('ChatInput-chat', 'message'),
          targetPort: semanticTargetPort('CustomComponent-merge', 'original_message'),
        },
      ],
    }
    const prepared = prepareCubeGraphLangflowExport(cube)
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const merged = cubeGraphToLfFlowData(prepared, base, (k) => getLfComponentDef(k, apiAllPath), apiAllPath)
    const edges = merged['edges'] as Array<Record<string, unknown>>
    const data = edges[0]!['data'] as Record<string, unknown>
    const targetHandle = data['targetHandle'] as Record<string, unknown>
    expect(targetHandle['fieldName']).toBe('original_message')
    expect(targetHandle['inputTypes']).toEqual(['Message'])
    expect(targetHandle['type']).toBe('other')
  })

  test('lf -> cube CustomComponent maps template.code to cube_lf_code_opaque', () => {
    const def = getLfComponentDef('CustomComponent', apiAllPath)
    expect(def).toBeTruthy()
    const raw = {
      data: {
        nodes: [
          {
            id: 'cc1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'cc1',
              type: 'CustomComponent',
              node: {
                ...(def as Record<string, unknown>),
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    const n = cube.nodes.find((x) => x.lfNodeId === 'cc1')
    expect(n?.cubeType).toBe('cube.lf.CustomComponent')
    const tpl = (def as Record<string, unknown>)['template'] as Record<string, unknown>
    const expected = (tpl['code'] as { value: string }).value
    expect(n?.config[CUBE_LF_CODE_OPAQUE_KEY]).toBe(expected)
  })

  test('lf -> cube preserves node ids and edge count', () => {
    const raw = JSON.parse(readFileSync(goldenPath, 'utf-8')) as Record<string, unknown>
    const cube = lfFlowDocumentToCubeGraph(raw)
    expect(cube.schemaVersion).toBe(1)
    expect(cube.nodes.length).toBeGreaterThan(0)
    expect(cube.edges.length).toBeGreaterThan(0)
    for (const n of cube.nodes) {
      expect(n.lfNodeId).toBe(n.id)
      expect(n.cubeType.startsWith('cube.lf.')).toBe(true)
    }
  })

  test('lf -> cube -> lf merge keeps template.code on Agent node', () => {
    const raw = JSON.parse(readFileSync(goldenPath, 'utf-8')) as Record<string, unknown>
    const data = raw['data'] as Record<string, unknown>
    const cube = lfFlowDocumentToCubeGraph(raw)
    const agentBefore = (data['nodes'] as unknown[]).find(
      (n) => (n as { id?: string }).id === 'Agent-NZuKj',
    ) as Record<string, unknown> | undefined
    const codeBefore = JSON.stringify(agentBefore)

    const merged = cubeGraphToLfFlowData(cube, data)
    const nodesAfter = merged['nodes'] as unknown[]
    const agentAfter = nodesAfter.find((n) => (n as { id?: string }).id === 'Agent-NZuKj') as
      | Record<string, unknown>
      | undefined
    expect(agentAfter).toBeDefined()
    const codeAfter = JSON.stringify(agentAfter)
    expect(codeAfter).toContain(codeBefore.slice(0, 200))
    expect((merged['edges'] as unknown[]).length).toBe(cube.edges.length)
  })

  test('empty LF base + new Cube nodes become genericNode shells via api-all', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'uuid-embed',
          lfNodeId: 'AIMLEmbeddings-test1',
          cubeType: 'cube.lf.AIMLEmbeddings',
          x: -288,
          y: -800,
          width: 240,
          height: 100,
          config: {},
        },
        {
          id: 'uuid-model',
          lfNodeId: 'AIMLModel-test2',
          cubeType: 'cube.lf.AIMLModel',
          x: -288,
          y: -642,
          width: 240,
          height: 100,
          config: {},
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    expect(nodes.length).toBe(2)
    const n0 = nodes[0]!
    const n1 = nodes[1]!
    expect(n0['type']).toBe('genericNode')
    expect(n0['id']).toBe('AIMLEmbeddings-test1')
    const d0 = n0['data'] as Record<string, unknown>
    expect(d0['type']).toBe('AIMLEmbeddings')
    const inner0 = d0['node'] as Record<string, unknown>
    expect(inner0['template']).toBeDefined()
    expect(n1['id']).toBe('AIMLModel-test2')
    expect((n1['data'] as Record<string, unknown>)['type']).toBe('AIMLModel')
  })

  test('cube -> lf Language Model node: default ollama_base_url is literal not global variable name', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'local-lm',
          lfNodeId: 'LanguageModelComponent-1',
          cubeType: 'cube.lf.LanguageModelComponent',
          x: 0,
          y: 0,
          width: 260,
          height: 200,
          config: { provider: 'OpenAI', model_name: 'gpt-4o-mini' },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    expect(nodes.length).toBe(1)
    const tpl = ((nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>)[
      'template'
    ] as Record<string, unknown>
    const ollama = tpl['ollama_base_url'] as Record<string, unknown>
    expect(ollama['value']).toBe('http://localhost:11434')
    expect(ollama['load_from_db']).toBe(false)
  })

  test('cube -> lf merges existing Agent (LF snapshot): connect_other_models rewrites template', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const agentDef = getLfComponentDef('Agent', apiAll)
    expect(agentDef).toBeTruthy()
    const innerSnap = JSON.parse(JSON.stringify(agentDef)) as Record<string, unknown>
    const baseLfData: Record<string, unknown> = {
      nodes: [
        {
          id: 'Agent-existing',
          type: 'genericNode',
          position: { x: 10, y: 20 },
          measured: { width: 280, height: 300 },
          selected: false,
          dragging: false,
          data: {
            id: 'Agent-existing',
            type: 'Agent',
            node: innerSnap,
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'local-x6',
          lfNodeId: 'Agent-existing',
          cubeType: 'cube.lf.Agent',
          x: 10,
          y: 20,
          width: 280,
          height: 300,
          config: {
            agent_llm: AGENT_LLM_CONNECT_OTHER,
            system_prompt: 'hello from cube',
          },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, baseLfData, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    expect(nodes.length).toBe(1)
    const tpl = ((nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>)[
      'template'
    ] as Record<string, unknown>
    const slot = tpl['model'] as Record<string, unknown>
    expect(slot['input_types']).toEqual(['LanguageModel'])
    expect(tpl['api_key']).toBeUndefined()
    const sp = tpl['system_prompt'] as Record<string, unknown>
    expect(sp['value']).toBe('hello from cube')
  })

  test('cube -> lf Agent restore inline provider keeps template.code (Langflow custom_component/update requires body.code)', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const agentDef = getLfComponentDef('Agent', apiAll)
    expect(agentDef).toBeTruthy()
    const innerSnap = JSON.parse(JSON.stringify(agentDef)) as Record<string, unknown>
    const tpl0 = innerSnap['template'] as Record<string, unknown>
    const modelSlot = tpl0['model'] as Record<string, unknown>
    modelSlot['input_types'] = ['LanguageModel']
    modelSlot['value'] = ''

    const baseLfData: Record<string, unknown> = {
      nodes: [
        {
          id: 'Agent-restore-code',
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 280, height: 300 },
          selected: false,
          dragging: false,
          data: {
            id: 'Agent-restore-code',
            type: 'Agent',
            node: innerSnap,
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'local',
          lfNodeId: 'Agent-restore-code',
          cubeType: 'cube.lf.Agent',
          x: 0,
          y: 0,
          width: 280,
          height: 300,
          config: { agent_llm: 'OpenAI' },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, baseLfData, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const tpl = ((nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>)[
      'template'
    ] as Record<string, unknown>
    const codeSlot = tpl['code'] as Record<string, unknown> | undefined
    expect(codeSlot).toBeDefined()
    expect(typeof codeSlot!['value']).toBe('string')
    expect((codeSlot!['value'] as string).length).toBeGreaterThan(500)
  })

  test('cube -> lf Agent connect_other_models patches model to LanguageModel and drops provider template slots', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'a1',
          lfNodeId: 'Agent-test1',
          cubeType: 'cube.lf.Agent',
          x: 0,
          y: 0,
          width: 280,
          height: 200,
          config: { agent_llm: AGENT_LLM_CONNECT_OTHER, system_prompt: 'hello' },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    expect(nodes.length).toBe(1)
    const tpl = ((nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>)[
      'template'
    ] as Record<string, unknown>
    const slot = tpl['model'] as Record<string, unknown>
    expect(slot['input_types']).toEqual(['LanguageModel'])
    expect(tpl['api_key']).toBeUndefined()
  })

  test('Cube protocol targetPort agent_llm maps to Langflow model handle; cube graph keeps agent_llm', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'lm',
          lfNodeId: 'LM-1',
          cubeType: 'cube.lf.DeepSeekModelComponent',
          x: 0,
          y: 0,
          width: 320,
          height: 400,
          config: {},
        },
        {
          id: 'ag',
          lfNodeId: 'Agent-1',
          cubeType: 'cube.lf.Agent',
          x: 400,
          y: 0,
          width: 320,
          height: 400,
          config: { agent_llm: AGENT_LLM_CONNECT_OTHER },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'lm',
          target: 'ag',
          sourcePort: semanticSourcePort('LM-1', 'model_output'),
          targetPort: semanticTargetPort('Agent-1', 'agent_llm'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAll))
    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges.length).toBe(1)
    const data = edges[0]!['data'] as Record<string, unknown>
    const th = data['targetHandle'] as Record<string, unknown>
    expect(th['fieldName']).toBe('model')
    expect(cube.edges[0]!.targetPort).toContain('agent_llm')
  })

  test('cube -> lf Agent infers external model mode from incoming model edge even if config lacks connect_other_models', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'lm',
          lfNodeId: 'LM-edge-infer',
          cubeType: 'cube.lf.DeepSeekModelComponent',
          x: 0,
          y: 0,
          width: 320,
          height: 400,
          config: { api_key: 'sk-edge-infer' },
        },
        {
          id: 'ag',
          lfNodeId: 'Agent-edge-infer',
          cubeType: 'cube.lf.Agent',
          x: 400,
          y: 0,
          width: 320,
          height: 400,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'lm',
          target: 'ag',
          sourcePort: semanticSourcePort('LM-edge-infer', 'model_output'),
          targetPort: semanticTargetPort('Agent-edge-infer', 'agent_llm'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const agent = nodes.find((n) => n['id'] === 'Agent-edge-infer')
    expect(agent).toBeTruthy()
    const tpl = (((agent!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>)[
      'template'
    ] ?? {}) as Record<string, unknown>
    const slot = tpl['model'] as Record<string, unknown>
    expect(slot['input_types']).toEqual(['LanguageModel'])
    expect(slot['value']).toBe(AGENT_LLM_CONNECT_OTHER)
    expect(tpl['api_key']).toBeUndefined()
    expect(tpl['model_name']).toBeUndefined()
  })

  test('cube -> lf OpenAIModel: api_key merge sets load_from_db false so LF persists inline secret', () => {
    const resolve = (k: string): Record<string, unknown> | null => {
      if (k !== 'OpenAIModel') return null
      return {
        template: {
          _type: 'Component',
          api_key: {
            _input_type: 'SecretStrInput',
            name: 'api_key',
            load_from_db: true,
            password: true,
            value: 'OPENAI_API_KEY',
          },
          model_name: {
            _input_type: 'DropdownInput',
            name: 'model_name',
            value: 'gpt-4o-mini',
          },
        },
        outputs: [{ name: 'text_output', types: ['Message'], tool_mode: true }],
      }
    }
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: 'LF-OAI',
          cubeType: 'cube.lf.OpenAIModel',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: { api_key: 'sk-test-secret-from-cube', model_name: 'gpt-4o-mini' },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, resolve)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const inner = (nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const keySlot = (inner['template'] as Record<string, unknown>)['api_key'] as Record<string, unknown>
    expect(keySlot['value']).toBe('sk-test-secret-from-cube')
    expect(keySlot['load_from_db']).toBe(false)
  })

  test('cube -> lf OpenAIModel: api_key OPENAI_API_KEY placeholder without cube secret normalizes load_from_db false', () => {
    const resolve = (k: string): Record<string, unknown> | null => {
      if (k !== 'OpenAIModel') return null
      return {
        template: {
          _type: 'Component',
          api_key: {
            _input_type: 'SecretStrInput',
            name: 'api_key',
            load_from_db: true,
            password: true,
            value: 'OPENAI_API_KEY',
          },
          model_name: {
            _input_type: 'DropdownInput',
            name: 'model_name',
            value: 'gpt-4o-mini',
          },
        },
        outputs: [{ name: 'text_output', types: ['Message'], tool_mode: true }],
      }
    }
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: 'LF-OAI',
          cubeType: 'cube.lf.OpenAIModel',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: { model_name: 'gpt-4o-mini' },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, resolve)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const inner = (nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const keySlot = (inner['template'] as Record<string, unknown>)['api_key'] as Record<string, unknown>
    expect(keySlot['value']).toBe('OPENAI_API_KEY')
    expect(keySlot['load_from_db']).toBe(false)
  })

  test('normalizeLoadFromDbInlineLiteralsDeep: nested model.value.template.api_key OPENAI_API_KEY placeholder', () => {
    const tpl: Record<string, unknown> = {
      _type: 'Component',
      model: {
        name: 'model',
        value: {
          _type: 'Component',
          template: {
            _type: 'Component',
            api_key: {
              _input_type: 'SecretStrInput',
              password: true,
              load_from_db: true,
              value: 'OPENAI_API_KEY',
            },
          },
        },
      },
    }
    normalizeLoadFromDbInlineLiteralsDeep(tpl)
    const nested = (tpl['model'] as Record<string, unknown>)['value'] as Record<string, unknown>
    const apiKey = (nested['template'] as Record<string, unknown>)['api_key'] as Record<string, unknown>
    expect(apiKey['load_from_db']).toBe(false)
  })

  test('cube -> lf removes nodes deleted from cube (LF pruned to match cube)', () => {
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: 'n-stay',
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 240, height: 100 },
          data: {
            id: 'n-stay',
            type: 'X',
            node: {
              template: { _type: 'Component' },
              display_name: 'A',
            },
          },
        },
        {
          id: 'n-gone',
          type: 'genericNode',
          position: { x: 100, y: 0 },
          measured: { width: 240, height: 100 },
          data: {
            id: 'n-gone',
            type: 'Y',
            node: {
              template: { _type: 'Component' },
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'n-stay',
          lfNodeId: 'n-stay',
          cubeType: 'cube.lf.X',
          x: 10,
          y: 20,
          width: 200,
          height: 90,
          config: {},
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base)
    const nodes = merged['nodes'] as Array<{ id?: string }>
    expect(nodes.length).toBe(1)
    expect(nodes[0]!.id).toBe('n-stay')
    expect(nodes.some((n) => n.id === 'n-gone')).toBe(false)
    const stayed = nodes[0] as Record<string, unknown>
    const pos = stayed['position'] as Record<string, number>
    expect(pos['x']).toBe(10)
    expect(pos['y']).toBe(20)
  })

  test('multi-port semantic edges map lfNodeId on source/target and handles', () => {
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-a',
          lfNodeId: 'LF-A',
          cubeType: 'cube.lf.Foo',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
        {
          id: 'cell-b',
          lfNodeId: 'LF-B',
          cubeType: 'cube.lf.Bar',
          x: 100,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'cell-a',
          target: 'cell-b',
          sourcePort: semanticSourcePort('LF-A', 'out1'),
          targetPort: semanticTargetPort('LF-B', 'in1'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base)
    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges.length).toBe(1)
    expect(edges[0]!['source']).toBe('LF-A')
    expect(edges[0]!['target']).toBe('LF-B')
    const d = edges[0]!['data'] as Record<string, unknown> | undefined
    expect(d).toBeDefined()
    const sh = d!['sourceHandle'] as Record<string, unknown>
    const th = d!['targetHandle'] as Record<string, unknown>
    expect(sh['id']).toBe('LF-A')
    expect(sh['name']).toBe('out1')
    expect(th['id']).toBe('LF-B')
    expect(th['fieldName']).toBe('in1')
  })

  test('lf -> cube extracts fieldUi from template.show; cube -> lf restores show and node tool_mode', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'n1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'n1',
              type: 'TestCmp',
              node: {
                tool_mode: true,
                template: {
                  _type: 'Component',
                  foo: {
                    _input_type: 'StrInput',
                    name: 'foo',
                    show: false,
                    advanced: true,
                    value: 'x',
                  },
                  bar: {
                    _input_type: 'StrInput',
                    name: 'bar',
                    show: true,
                    advanced: false,
                    value: 'y',
                  },
                },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    const n = cube.nodes.find((x) => x.id === 'n1')
    expect(n?.fieldUi?.fieldEnabled?.foo).toBe(false)
    expect(n?.fieldUi?.fieldEnabled?.bar).toBe(true)
    expect(n?.fieldUi?.fieldAdvanced?.foo).toBe(true)
    expect(n?.fieldUi?.fieldAdvanced?.bar).toBe(false)
    expect(n?.fieldUi?.nodeToolMode).toBe(true)

    const merged = cubeGraphToLfFlowData(cube, raw.data as Record<string, unknown>)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const ln = nodes.find((x) => x['id'] === 'n1')
    const inner = (ln?.['data'] as Record<string, unknown>)?.['node'] as Record<string, unknown>
    expect(inner['tool_mode']).toBe(true)
    const tpl = inner['template'] as Record<string, unknown>
    expect((tpl['foo'] as Record<string, unknown>)['show']).toBe(false)
    expect((tpl['bar'] as Record<string, unknown>)['show']).toBe(true)
    expect((tpl['foo'] as Record<string, unknown>)['advanced']).toBe(true)
    expect((tpl['bar'] as Record<string, unknown>)['advanced']).toBe(false)
  })

  test('lf -> cube preserves inner.display_name; cube -> lf writes config.display_name', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'n1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'n1',
              type: 'TestCmp',
              node: {
                display_name: 'Extract Web Data',
                template: {
                  _type: 'Component',
                },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    let cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    expect(cube.nodes[0]!.config['display_name']).toBe('Extract Web Data')
    const n = {
      ...cube.nodes[0]!,
      config: { ...cube.nodes[0]!.config, display_name: 'AgentQL' },
    }
    cube = { ...cube, nodes: [n] }
    const merged = cubeGraphToLfFlowData(cube, raw.data as Record<string, unknown>)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const inner = (nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    expect(inner['display_name']).toBe('AgentQL')
  })

  test('lf -> cube preserves inner.field_order; cube -> lf restores', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'n1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'n1',
              type: 'Fake',
              node: {
                field_order: ['z', 'a', 'm'],
                template: {
                  _type: 'Component',
                  z: { value: '' },
                  a: { value: '' },
                  m: { value: '' },
                },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    expect(cube.nodes[0]!.fieldOrder).toEqual(['z', 'a', 'm'])
    const merged = cubeGraphToLfFlowData(cube, raw.data as Record<string, unknown>)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const inner = (nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    expect(inner['field_order']).toEqual(['z', 'a', 'm'])
  })

  test('field_order strips names missing from template on lf -> cube and cube -> lf', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'n1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'n1',
              type: 'Fake',
              node: {
                field_order: ['ghost', 'z', 'removed', 'z', 'a'],
                template: {
                  _type: 'Component',
                  z: { value: '' },
                  a: { value: '' },
                },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    expect(cube.nodes[0]!.fieldOrder).toEqual(['z', 'a'])
    const merged = cubeGraphToLfFlowData(cube, raw.data as Record<string, unknown>)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const inner = (nodes[0]!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    expect(inner['field_order']).toEqual(['z', 'a'])
  })

  test('lf -> cube maps data.selected_output to selectedOutputIdx; cube -> lf restores', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'n1',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 240, height: 100 },
            data: {
              id: 'n1',
              type: 'Fake',
              selected_output: 'second',
              node: {
                outputs: [
                  { name: 'first', types: ['Message'] },
                  { name: 'second', types: ['Data'] },
                ],
                template: { _type: 'Component' },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    expect(cube.nodes[0]!.selectedOutputIdx).toBe(1)
    const merged = cubeGraphToLfFlowData(cube, raw.data as Record<string, unknown>)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const d = nodes[0]!['data'] as Record<string, unknown>
    expect(d['selected_output']).toBe('second')
  })

  test('cube -> lf: selected_output follows outgoing edge when selectedOutputIdx mismatches (LF edge visibility)', () => {
    const raw = {
      data: {
        nodes: [
          {
            id: 'LM-A',
            type: 'genericNode',
            position: { x: 0, y: 0 },
            measured: { width: 320, height: 100 },
            data: {
              id: 'LM-A',
              type: 'DualOut',
              selected_output: 'text_out',
              node: {
                outputs: [
                  { name: 'text_out', types: ['Message'] },
                  { name: 'model_out', types: ['LanguageModel'] },
                ],
                template: { _type: 'Component' },
              },
            },
          },
        ],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    }
    const cube = lfFlowDocumentToCubeGraph(raw as Record<string, unknown>)
    cube.nodes[0]!.selectedOutputIdx = 0
    cube.edges = [
      {
        id: 'e1',
        source: cube.nodes[0]!.id,
        target: 'Agent-1',
        sourcePort: semanticSourcePort(cube.nodes[0]!.lfNodeId, 'model_out'),
        targetPort: semanticTargetPort('Agent-1', 'model'),
      },
    ]
    const merged = cubeGraphToLfFlowData(cube, raw.data as Record<string, unknown>)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const d = nodes[0]!['data'] as Record<string, unknown>
    expect(d['selected_output']).toBe('model_out')
  })

  test('empty LF base: appended LanguageModel uses model_output from edge when selectedOutputIdx is 0', () => {
    clearLfApiAllCaches()
    const apiAll = apiAllPath
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-lm',
          lfNodeId: 'LM-node-lf',
          cubeType: 'cube.lf.LanguageModelComponent',
          x: 0,
          y: 0,
          width: 320,
          height: 200,
          config: { provider: 'OpenAI', model_name: 'gpt-4o-mini' },
          selectedOutputIdx: 0,
        },
        {
          id: 'cell-agent',
          lfNodeId: 'Agent-node-lf',
          cubeType: 'cube.lf.Agent',
          x: 400,
          y: 0,
          width: 320,
          height: 200,
          config: { agent_llm: AGENT_LLM_CONNECT_OTHER, system_prompt: 'hi' },
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'cell-lm',
          target: 'cell-agent',
          sourcePort: semanticSourcePort('LM-node-lf', 'model_output'),
          targetPort: semanticTargetPort('Agent-node-lf', 'model'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAll))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const lm = nodes.find((n) => n['id'] === 'LM-node-lf')
    expect(lm).toBeDefined()
    const d = lm!['data'] as Record<string, unknown>
    expect(d['selected_output']).toBe('model_output')
    const inner = d['node'] as Record<string, unknown>
    const outs = inner['outputs'] as Array<Record<string, unknown>>
    const mo = outs.find((o) => o['name'] === 'model_output')
    expect(mo?.['selected']).toBe('LanguageModel')
    expect((merged['edges'] as unknown[]).length).toBe(1)
  })

  test('cube -> lf fills edge handle types from resolveComponent when snapshot has no types', () => {
    // Foo 有两个输出类型但无 selected；cleanEdges 公式：多类型时取 [selected]，无 selected 则取 types[0]
    const resolve = (k: string): Record<string, unknown> | null => {
      if (k === 'Foo') {
        return {
          template: {
            _type: 'Component',
            in1: { name: 'in1', input_types: ['Message'], type: 'str', value: '' },
          },
          outputs: [{ name: 'out1', types: ['Message', 'Data'] }],
        }
      }
      if (k === 'Bar') {
        return {
          template: {
            _type: 'Component',
            in1: { name: 'in1', input_types: ['Message'], type: 'str', value: '' },
          },
          outputs: [],
        }
      }
      return null
    }
    const base: Record<string, unknown> = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-a',
          lfNodeId: 'LF-A',
          cubeType: 'cube.lf.Foo',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
        {
          id: 'cell-b',
          lfNodeId: 'LF-B',
          cubeType: 'cube.lf.Bar',
          x: 100,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'cell-a',
          target: 'cell-b',
          sourcePort: semanticSourcePort('LF-A', 'out1'),
          targetPort: semanticTargetPort('LF-B', 'in1'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, resolve)
    const edges = merged['edges'] as Array<Record<string, unknown>>
    const d = edges[0]!['data'] as Record<string, unknown>
    const sh = d['sourceHandle'] as Record<string, unknown>
    const th = d['targetHandle'] as Record<string, unknown>
    // dataType = component key（不是 output 类型）；output_types 按 cleanEdges 公式：多类型无 selected → types[0]
    expect(sh['dataType']).toBe('Foo')
    expect(sh['output_types']).toEqual(['Message'])
    expect(th['inputTypes']).toEqual(['Message'])
    // type 来自模板字段的 type 属性，不从 inputTypes 推导
    expect(th['type']).toBe('str')
  })

  test('cube -> lf Agent response→tools: node Tool 模式下 sourceHandle 与 LF cleanEdges 期望一致', () => {
    const resolve = (k: string): Record<string, unknown> | null => {
      if (k !== 'Agent') return null
      return {
        template: {
          _type: 'Component',
          tools: { name: 'tools', input_types: ['Tool'], type: 'other', value: '' },
        },
        outputs: [{ name: 'response', types: ['Message'], tool_mode: true }],
      }
    }
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-a',
          lfNodeId: 'LF-A',
          cubeType: 'cube.lf.Agent',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: {},
          fieldUi: { nodeToolMode: true },
        },
        {
          id: 'cell-b',
          lfNodeId: 'LF-B',
          cubeType: 'cube.lf.Agent',
          x: 100,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'cell-a',
          target: 'cell-b',
          sourcePort: semanticSourcePort('LF-A', 'response'),
          targetPort: semanticTargetPort('LF-B', 'tools'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, resolve)
    // 节点：LF 1.8+ tool_mode Agent 归一为 Toolset 输出 component_as_tool
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const nodeA = nodes.find((n) => n['id'] === 'LF-A')!
    const innerA = (nodeA['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const outputs = innerA['outputs'] as Array<Record<string, unknown>>
    expect(outputs).toHaveLength(1)
    expect(outputs[0]!['name']).toBe('component_as_tool')
    expect(outputs[0]!['types']).toContain('Tool')
    expect(outputs[0]!['selected']).toBe('Tool')
    // 边：Cube 语义端口仍可为 response，句柄名与 LF 一致为 component_as_tool
    const edges = merged['edges'] as Array<Record<string, unknown>>
    const d = edges[0]!['data'] as Record<string, unknown>
    const sh = d['sourceHandle'] as Record<string, unknown>
    const th = d['targetHandle'] as Record<string, unknown>
    expect(sh['dataType']).toBe('Agent')
    expect(sh['name']).toBe('component_as_tool')
    expect(sh['output_types']).toEqual(['Tool'])
    // targetHandle.type 来自模板字段 type 属性（HandleInput = "other"）
    expect(th['type']).toBe('other')
    expect(th['inputTypes']).toEqual(['Tool'])
  })

  test('cube -> lf Response→tools：LF 快照 inner.tool_mode=true 时，即使 cube 节点无 fieldUi 也补全 Tool 并对齐 cleanEdges', () => {
    const resolve = (k: string): Record<string, unknown> | null => {
      if (k !== 'Agent') return null
      return {
        template: {
          _type: 'Component',
          tools: { name: 'tools', input_types: ['Tool'], type: 'other', value: '' },
        },
        outputs: [{ name: 'response', types: ['Message'], tool_mode: true }],
      }
    }
    const baseLf: Record<string, unknown> = {
      nodes: [
        {
          id: 'LF-A',
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 200, height: 80 },
          data: {
            id: 'LF-A',
            type: 'Agent',
            node: {
              tool_mode: true,
              template: { _type: 'Component' },
              outputs: [{ name: 'response', types: ['Message'], tool_mode: true }],
            },
          },
        },
        {
          id: 'LF-B',
          type: 'genericNode',
          position: { x: 100, y: 0 },
          measured: { width: 200, height: 80 },
          data: {
            id: 'LF-B',
            type: 'Agent',
            node: {
              tool_mode: false,
              template: { _type: 'Component' },
              outputs: [{ name: 'response', types: ['Message'], tool_mode: true }],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-a',
          lfNodeId: 'LF-A',
          cubeType: 'cube.lf.Agent',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: {},
          // 无 fieldUi；tool_mode 来自 LF 快照
        },
        {
          id: 'cell-b',
          lfNodeId: 'LF-B',
          cubeType: 'cube.lf.Agent',
          x: 100,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'cell-a',
          target: 'cell-b',
          sourcePort: semanticSourcePort('LF-A', 'response'),
          targetPort: semanticTargetPort('LF-B', 'tools'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, baseLf, resolve)
    // 节点：快照 inner.tool_mode=true 应归一为 component_as_tool
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const nodeA = nodes.find((n) => n['id'] === 'LF-A')!
    const innerA = (nodeA['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const outputs = innerA['outputs'] as Array<Record<string, unknown>>
    expect(outputs.some((o) => o['name'] === 'component_as_tool')).toBe(true)
    const cat = outputs.find((o) => o['name'] === 'component_as_tool')!
    expect(cat['types']).toContain('Tool')
    // 边：dataType = "Agent"，句柄名为 component_as_tool，output_types = ["Tool"]
    const edges = merged['edges'] as Array<Record<string, unknown>>
    const d = edges[0]!['data'] as Record<string, unknown>
    const sh = d['sourceHandle'] as Record<string, unknown>
    expect(sh['dataType']).toBe('Agent')
    expect(sh['name']).toBe('component_as_tool')
    expect(sh['output_types']).toEqual(['Tool'])
  })

  test('cube -> lf: preserves node lf_version / last_updated from base; Parser keeps clean_data; new node gets sample lf_version', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('ParserComponent', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    template['clean_data'] = {
      _input_type: 'BoolInput',
      name: 'clean_data',
      display_name: 'Clean Data',
      value: true,
      show: true,
    }
    const lfId = 'parser-meta'
    const lfNewId = 'parser-new-from-def'
    const fo = [...((def!['field_order'] as string[]) ?? []), 'clean_data']
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 200, height: 80 },
          data: {
            id: lfId,
            type: 'ParserComponent',
            node: {
              lf_version: '1.8.2',
              last_updated: '2026-04-03T08:47:15.938Z',
              template,
              outputs: def!['outputs'],
              field_order: fo,
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c-p',
          lfNodeId: lfId,
          cubeType: 'cube.lf.ParserComponent',
          x: 0,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
        {
          id: 'c-new',
          lfNodeId: lfNewId,
          cubeType: 'cube.lf.ParserComponent',
          x: 100,
          y: 100,
          width: 200,
          height: 80,
          config: {},
        },
      ],
      edges: [],
    }
    const resolve = (k: string) => getLfComponentDef(k, apiAllPath)
    const merged = cubeGraphToLfFlowData(cube, base, resolve)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const n = nodes.find((x) => x['id'] === lfId)
    const inner = (n!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    expect(inner['lf_version']).toBe('1.8.2')
    expect(inner['last_updated']).toBe('2026-04-03T08:47:15.938Z')
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['clean_data']).toBeTruthy()
    const outFo = inner['field_order'] as string[] | undefined
    expect(outFo?.includes('clean_data')).toBe(true)

    const nNew = nodes.find((x) => x['id'] === lfNewId)
    const innerNew = (nNew!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    expect(innerNew['lf_version']).toBe('1.8.2')
  })

  test('cube -> lf: ParserComponent Stringify fixes pattern show/required and injects clean_data (LF update_build_config parity)', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('ParserComponent', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const modeSlot = template['mode'] as Record<string, unknown>
    modeSlot['value'] = 'Stringify'
    const pat = template['pattern'] as Record<string, unknown>
    pat['show'] = true
    pat['required'] = true
    const lfId = 'parser-stringify-shape'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 320, height: 408 },
          data: {
            id: lfId,
            type: 'ParserComponent',
            node: {
              lf_version: '1.8.2',
              template,
              outputs: def!['outputs'],
              field_order: ['input_data', 'mode', 'pattern', 'sep'],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c-p',
          lfNodeId: lfId,
          cubeType: 'cube.lf.ParserComponent',
          x: 0,
          y: 0,
          width: 320,
          height: 408,
          config: { mode: 'Stringify' },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const n = nodes.find((x) => x['id'] === lfId)
    const inner = (n!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    const patOut = tpl['pattern'] as Record<string, unknown>
    expect(patOut['show']).toBe(false)
    expect(patOut['required']).toBe(false)
    expect(tpl['clean_data']).toBeTruthy()
    expect((inner['field_order'] as string[]).includes('clean_data')).toBe(true)
  })

  test('cube -> lf: MCPTools node tool mode → Toolset output and response→tools uses component_as_tool', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const lfId = 'mcp-toolmode'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 280, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: JSON.parse(
              JSON.stringify({
                template: def!['template'],
                outputs: def!['outputs'],
                field_order: def!['field_order'],
              }),
            ),
          },
        },
        {
          id: 'LF-B',
          type: 'genericNode',
          position: { x: 320, y: 0 },
          measured: { width: 200, height: 80 },
          data: {
            id: 'LF-B',
            type: 'Agent',
            node: {
              tool_mode: false,
              template: { _type: 'Component' },
              outputs: [{ name: 'response', types: ['Message'], tool_mode: true }],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c-mcp',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 280,
          height: 200,
          config: { mcp_server: 'bizdata1' },
          fieldUi: { nodeToolMode: true },
        },
        {
          id: 'c-ag',
          lfNodeId: 'LF-B',
          cubeType: 'cube.lf.Agent',
          x: 320,
          y: 0,
          width: 200,
          height: 80,
          config: {},
        },
      ],
      edges: [
        {
          id: 'e-mcp-tools',
          source: 'c-mcp',
          target: 'c-ag',
          sourcePort: semanticSourcePort(lfId, 'response'),
          targetPort: semanticTargetPort('LF-B', 'tools'),
        },
      ],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const mcpNode = nodes.find((n) => n['id'] === lfId)
    const inner = (mcpNode!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const outputs = inner['outputs'] as Array<Record<string, unknown>>
    expect(outputs.some((o) => o['name'] === 'component_as_tool')).toBe(true)
    const edges = merged['edges'] as Array<Record<string, unknown>>
    expect(edges).toHaveLength(1)
    const d = edges[0]!['data'] as Record<string, unknown>
    const sh = d['sourceHandle'] as Record<string, unknown>
    expect(sh['name']).toBe('component_as_tool')
    expect(sh['dataType']).toBe('MCPTools')
    expect(sh['output_types']).toEqual(['Tool'])
    const tpl = inner['template'] as Record<string, unknown>
    expect((tpl['tool'] as Record<string, unknown>)['show']).toBe(false)
    const tm = tpl['tools_metadata'] as Record<string, unknown>
    expect(tm['show']).toBe(true)
    expect(tm['_input_type']).toBe('ToolsInput')
    expect(Array.isArray(tm['value']) && (tm['value'] as unknown[]).length > 0).toBe(true)
  })

  test('reconcileMcpToolsToolsetTemplateInLfData maps tool.options into tools_metadata Actions', () => {
    const lfId = 'mcp-rec'
    const inner: Record<string, unknown> = {
      tool_mode: true,
      template: {
        tool: { show: true, options: ['alpha_tool', 'beta_tool'], value: '' },
      },
      outputs: [{ name: 'component_as_tool', types: ['Tool'], tool_mode: true, selected: 'Tool' }],
    }
    const lfData: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          data: { type: 'MCPTools', node: inner },
        },
      ],
    }
    const graph: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          config: {},
        },
      ],
      edges: [],
    }
    reconcileMcpToolsToolsetTemplateInLfData(lfData, graph)
    const tpl = inner['template'] as Record<string, unknown>
    expect((tpl['tool'] as Record<string, unknown>)['show']).toBe(false)
    const meta = tpl['tools_metadata'] as Record<string, unknown>
    const val = meta['value'] as Array<Record<string, unknown>>
    expect(val).toHaveLength(2)
    expect(val[0]!['name']).toBe('alpha_tool')
    expect(val[1]!['name']).toBe('beta_tool')
    expect(val[0]!['description']).toBe('')
    expect(String(val[0]!['display_name'])).toBe('Alpha Tool')
  })

  test('reconcileMcpToolsToolsetTemplateInLfData uses listTools descriptions when provided', () => {
    const lfId = 'mcp-rec-2'
    const inner: Record<string, unknown> = {
      tool_mode: true,
      template: {
        tool: { show: true, options: ['alpha_tool', 'beta_tool'], value: '' },
      },
      outputs: [{ name: 'component_as_tool', types: ['Tool'], tool_mode: true, selected: 'Tool' }],
    }
    const lfData: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          data: { type: 'MCPTools', node: inner },
        },
      ],
    }
    const graph: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          config: {},
        },
      ],
      edges: [],
    }
    const listed = new Map([
      [
        lfId,
        [
          { name: 'alpha_tool', description: 'Alpha docs', inputSchema: { title: 'Alpha Title' } },
          { name: 'beta_tool', description: 'Beta docs', inputSchema: null },
        ],
      ],
    ])
    reconcileMcpToolsToolsetTemplateInLfData(lfData, graph, listed)
    const meta = (inner['template'] as Record<string, unknown>)['tools_metadata'] as Record<string, unknown>
    const val = meta['value'] as Array<Record<string, unknown>>
    expect(val[0]!['description']).toBe('Alpha docs')
    expect(val[0]!['display_name']).toBe('Alpha Title')
    expect(val[1]!['description']).toBe('Beta docs')
  })

  test('reconcileMcpToolsToolsetTemplateInLfData fills tools_metadata.args from listTools inputSchema', () => {
    const lfId = 'mcp-rec-args'
    const inner: Record<string, unknown> = {
      tool_mode: true,
      template: {
        tool: { show: true, options: ['alarm_common_statistics'], value: '' },
      },
      outputs: [{ name: 'component_as_tool', types: ['Tool'], tool_mode: true, selected: 'Tool' }],
    }
    const lfData: Record<string, unknown> = {
      nodes: [{ id: lfId, data: { type: 'MCPTools', node: inner } }],
    }
    const graph: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          config: {},
        },
      ],
      edges: [],
    }
    const listed = new Map([
      [
        lfId,
        [
          {
            name: 'alarm_common_statistics',
            description: '统计',
            inputSchema: {
              type: 'object',
              properties: {
                begin_time: { title: 'Begin Time', type: 'string' },
                app_codes: { type: 'string' },
                item_error_value_flag: { type: 'boolean' },
              },
            },
          },
        ],
      ],
    ])
    reconcileMcpToolsToolsetTemplateInLfData(lfData, graph, listed)
    const meta = (inner['template'] as Record<string, unknown>)['tools_metadata'] as Record<string, unknown>
    const val = meta['value'] as Array<Record<string, unknown>>
    expect(val).toHaveLength(1)
    const args = val[0]!['args'] as Record<string, unknown>
    expect(args['begin_time']).toEqual({ title: 'Begin Time', type: 'string' })
    expect(args['app_codes']).toEqual({ title: 'App Codes', type: 'string' })
    expect(args['item_error_value_flag']).toEqual({ title: 'Item Error Value Flag', type: 'boolean' })
  })

  test('cube -> lf: MCPTools injects dynamic template slots and keeps field_order after tool', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const lfId = 'mcp-n1'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 10, y: 20 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: {
              template,
              field_order: ['mcp_server', 'use_cache', 'verify_ssl', 'tool', 'tool_placeholder'],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'x1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { name: 'bizData' } },
            tool: 'alarm_common_statistics',
            app_codes: 'acodes',
            begin_time: 't1',
            end_time: 't2',
            event_types: 'ev',
          },
          mcpDynamicSchemaInputs: [
            {
              name: 'app_codes',
              displayName: 'App Codes',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
            {
              name: 'begin_time',
              displayName: 'Begin Time',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
            {
              name: 'end_time',
              displayName: 'End Time',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
            {
              name: 'event_types',
              displayName: 'Event Types',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
          ],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const mcpNode = nodes.find((n) => n['id'] === lfId)
    expect(mcpNode).toBeTruthy()
    const inner = (mcpNode!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['app_codes']).toBeTruthy()
    expect((tpl['app_codes'] as Record<string, unknown>)['value']).toBe('acodes')
    expect((tpl['begin_time'] as Record<string, unknown>)['value']).toBe('t1')
    const fo = inner['field_order'] as string[]
    expect(fo.indexOf('begin_time')).toBeGreaterThan(fo.indexOf('tool'))
  })

  test('injectLfMcpToolsDynamicSlotsFromListedTools injects LF template slots when cube omits mcpDynamicSchemaInputs', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const lfId = 'mcp-inject-listed'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 10, y: 20 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: {
              template,
              field_order: ['mcp_server', 'use_cache', 'verify_ssl', 'tool', 'tool_placeholder'],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { name: 'bizData' } },
            tool: 'alarm_common_statistics',
          },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const listed = new Map([
      [
        lfId,
        [
          {
            name: 'alarm_common_statistics',
            description: 'stat',
            inputSchema: {
              type: 'object',
              properties: {
                app_codes: { type: 'string', description: 'apps' },
                begin_time: { type: 'string' },
              },
              required: ['app_codes'],
            },
          },
        ],
      ],
    ])
    injectLfMcpToolsDynamicSlotsFromListedTools(merged, cube, listed)
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const mcpNode = nodes.find((n) => n['id'] === lfId)
    expect(mcpNode).toBeTruthy()
    const inner = (mcpNode!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['app_codes']).toBeTruthy()
    expect(tpl['begin_time']).toBeTruthy()
    const fo = inner['field_order'] as string[]
    expect(fo.includes('app_codes')).toBe(true)
    expect(fo.indexOf('app_codes')).toBeGreaterThan(fo.indexOf('tool'))
  })

  test('cube -> lf: MCPTools toolset mode strips dynamic template slots to avoid duplicate LF field rendering', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    ;(template as Record<string, unknown>)['begin_time'] = {
      _input_type: 'MessageTextInput',
      name: 'begin_time',
      display_name: 'Begin Time',
      value: '',
      show: true,
      input_types: ['Message'],
      type: 'str',
    }
    const lfId = 'mcp-toolset-strip'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 280, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: {
              template,
              field_order: ['mcp_server', 'tool', 'begin_time'],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 280,
          height: 200,
          config: { mcp_server: { bizData: { name: 'bizData' } }, tool: 'alarm_common_statistics' },
          fieldUi: { nodeToolMode: true },
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const mcpNode = nodes.find((n) => n['id'] === lfId)
    const inner = (mcpNode!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['begin_time']).toBeUndefined()
    const fo = inner['field_order'] as string[]
    expect(fo.includes('begin_time')).toBe(false)
  })

  test('cube -> lf: MCPTools restores tool from LF snapshot when cube tool was cleared (dynamic fields kept)', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const toolSlot = template['tool'] as Record<string, unknown>
    toolSlot['value'] = 'alarm_most_area_statistics'
    toolSlot['options'] = ['alarm_most_area_statistics', 'other_tool']
    const lfId = 'mcp-n1'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 10, y: 20 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: {
              template,
              field_order: ['mcp_server', 'use_cache', 'verify_ssl', 'tool', 'tool_placeholder'],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'x1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { name: 'bizData' } },
            tool: '',
            app_codes: 'acodes',
            begin_time: 't1',
            end_time: 't2',
            event_types: 'ev',
          },
          mcpDynamicSchemaInputs: [
            {
              name: 'app_codes',
              displayName: 'App Codes',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
            {
              name: 'begin_time',
              displayName: 'Begin Time',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
            {
              name: 'end_time',
              displayName: 'End Time',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
            {
              name: 'event_types',
              displayName: 'Event Types',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: true,
            },
          ],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    const mcpNode = nodes.find((n) => n['id'] === lfId)
    const inner = (mcpNode!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect((tpl['tool'] as Record<string, unknown>)['value']).toBe('alarm_most_area_statistics')
  })

  test('cube -> lf: MCPTools appends tool name to dropdown options when options were empty', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const toolSlot = template['tool'] as Record<string, unknown>
    toolSlot['options'] = []
    const lfId = 'mcp-opt'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: { template, field_order: ['mcp_server', 'tool', 'tool_placeholder'] },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { url: 'http://example/mcp' } },
            tool: 'alarm_most_area_statistics',
          },
          mcpDynamicSchemaInputs: [],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const inner = ((merged['nodes'] as Array<Record<string, unknown>>)[0]!['data'] as Record<string, unknown>)[
      'node'
    ] as Record<string, unknown>
    const opts = (inner['template'] as Record<string, unknown>)['tool'] as Record<string, unknown>
    expect(opts['options']).toEqual(['alarm_most_area_statistics'])
  })

  test('cube -> lf: MCPTools creates missing template.tool from api-all before merge', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    delete template['tool']
    const lfId = 'mcp-missing-tool-slot'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: { template, field_order: ['mcp_server', 'use_cache', 'verify_ssl', 'tool_placeholder'] },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { url: 'http://example/mcp' } },
            tool: 'alarm_most_area_statistics',
          },
          mcpDynamicSchemaInputs: [],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const inner = ((merged['nodes'] as Array<Record<string, unknown>>)[0]!['data'] as Record<string, unknown>)[
      'node'
    ] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['tool']).toBeTruthy()
    expect((tpl['tool'] as Record<string, unknown>)['value']).toBe('alarm_most_area_statistics')
  })

  test('cube -> lf: MCPTools writes mcp_server as Langflow { name, config } (not bizData bucket)', () => {
    clearLfApiAllCaches()
    const lfId = 'MCPTools-sync-shape'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 320, height: 400 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: {
              template: {},
              field_order: ['mcp_server', 'tool', 'tool_placeholder'],
            },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'n1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 320,
          height: 400,
          config: {
            mcp_server: {
              bizData: {
                url: 'http://192.168.0.194:8002/sse/',
                headers: {},
                timeout: 50,
                sse_read_timeout: 50,
              },
            },
            tool: 'device_number_statistics',
            verify_ssl: true,
          },
          mcpDynamicSchemaInputs: [],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const inner = ((merged['nodes'] as Array<Record<string, unknown>>)[0]!['data'] as Record<string, unknown>)[
      'node'
    ] as Record<string, unknown>
    const mcpSlot = (inner['template'] as Record<string, unknown>)['mcp_server'] as Record<string, unknown>
    const v = mcpSlot['value'] as Record<string, unknown>
    expect(v['name']).toBe('bizData')
    expect(v['config']).toEqual({
      url: 'http://192.168.0.194:8002/sse/',
      timeout: 50,
      sse_read_timeout: 50,
      verify_ssl: true,
    })
    const toolSlot = (inner['template'] as Record<string, unknown>)['tool'] as Record<string, unknown>
    expect(toolSlot['value']).toBe('device_number_statistics')
  })

  test('cube -> lf: MCPTools coerces numeric config.tool to string in template', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const lfId = 'mcp-tool-num'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: { template, field_order: ['mcp_server', 'tool', 'tool_placeholder'] },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { url: 'http://example/mcp' } },
            tool: 404 as unknown as string,
          },
          mcpDynamicSchemaInputs: [],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const tpl = (((merged['nodes'] as Array<Record<string, unknown>>)[0]!['data'] as Record<string, unknown>)[
      'node'
    ] as Record<string, unknown>)['template'] as Record<string, unknown>
    expect((tpl['tool'] as Record<string, unknown>)['value']).toBe('404')
  })

  test('cube -> lf: MCPTools reads tool name from object-shaped config.tool and fills template', () => {
    clearLfApiAllCaches()
    const def = getLfComponentDef('MCPTools', apiAllPath) as Record<string, unknown> | null
    expect(def).toBeTruthy()
    const template = JSON.parse(JSON.stringify(def!['template'])) as Record<string, unknown>
    delete template['code']
    const lfId = 'mcp-tool-obj'
    const base: Record<string, unknown> = {
      nodes: [
        {
          id: lfId,
          type: 'genericNode',
          position: { x: 0, y: 0 },
          measured: { width: 300, height: 200 },
          data: {
            id: lfId,
            type: 'MCPTools',
            node: { template, field_order: ['mcp_server', 'tool', 'tool_placeholder'] },
          },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'c1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { url: 'http://example/mcp' } },
            tool: { name: 'device_categories_number_statistics' } as unknown as string,
          },
          mcpDynamicSchemaInputs: [],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const tpl = (((merged['nodes'] as Array<Record<string, unknown>>)[0]!['data'] as Record<string, unknown>)[
      'node'
    ] as Record<string, unknown>)['template'] as Record<string, unknown>
    expect((tpl['tool'] as Record<string, unknown>)['value']).toBe('device_categories_number_statistics')
  })

  test('cube -> lf: appended MCPTools (no existing LF node) gets dynamic template + field_order', () => {
    clearLfApiAllCaches()
    const lfId = 'fresh-mcp-1'
    const base: Record<string, unknown> = {
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const cube: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'cell-1',
          lfNodeId: lfId,
          cubeType: 'cube.lf.MCPTools',
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          config: {
            mcp_server: { bizData: { url: 'http://example/mcp', headers: {} } },
            tool: 'my_tool',
            foo_param: 'bar',
          },
          mcpDynamicSchemaInputs: [
            {
              name: 'foo_param',
              displayName: 'Foo',
              inputType: 'MessageTextInput',
              fieldType: 'str',
              info: '',
              required: false,
            },
          ],
        },
      ],
      edges: [],
    }
    const merged = cubeGraphToLfFlowData(cube, base, (k) => getLfComponentDef(k, apiAllPath))
    const nodes = merged['nodes'] as Array<Record<string, unknown>>
    expect(nodes.length).toBe(1)
    const mcpNode = nodes[0]
    expect(mcpNode!['id']).toBe(lfId)
    const inner = (mcpNode!['data'] as Record<string, unknown>)['node'] as Record<string, unknown>
    const tpl = inner['template'] as Record<string, unknown>
    expect(tpl['foo_param']).toBeTruthy()
    expect((tpl['foo_param'] as Record<string, unknown>)['value']).toBe('bar')
    expect((tpl['tool'] as Record<string, unknown>)['value']).toBe('my_tool')
    const fo = inner['field_order'] as string[]
    expect(fo.includes('foo_param')).toBe(true)
    expect(fo.indexOf('foo_param')).toBeGreaterThan(fo.indexOf('tool'))
  })

  test('normalizeCubeGraphMcpDynamicSchema lifts backup from config for MCPTools', () => {
    const key = CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY
    const bak = [
      {
        name: 'app_codes',
        displayName: 'App',
        inputType: 'MessageTextInput',
        fieldType: 'str',
        info: '',
        required: true,
      },
    ]
    const g: CubeFlowGraph = {
      schemaVersion: 1,
      nodes: [
        {
          id: 'n1',
          lfNodeId: 'n1',
          cubeType: 'cube.lf.MCPTools',
          x: 0,
          y: 0,
          width: 100,
          height: 80,
          config: { tool: 't', [key]: bak },
        },
      ],
      edges: [],
    }
    const out = normalizeCubeGraphMcpDynamicSchema(g)
    expect(out.nodes[0]!.mcpDynamicSchemaInputs).toEqual([expect.objectContaining({ name: 'app_codes' })])
    expect((out.nodes[0]!.config as Record<string, unknown>)[key]).toEqual(bak)
  })

  test('normalizeMcpServerValueForFlowExport: bizData passthrough strips redundant config', () => {
    const a = normalizeMcpServerValueForFlowExport({
      name: 'svc',
      bizData: { url: 'http://192.168.0.194:8002/sse/', headers: {}, timeout: 50, sse_read_timeout: 50 },
      config: { should: 'be-removed' },
    }) as Record<string, unknown>
    expect(a['bizData']).toEqual({
      url: 'http://192.168.0.194:8002/sse/',
      headers: {},
      timeout: 50,
      sse_read_timeout: 50,
    })
    expect(a['config']).toBeUndefined()
    expect(a['name']).toBe('svc')
  })

  test('normalizeMcpServerValueForFlowExport: lifts config to bizData', () => {
    const a = normalizeMcpServerValueForFlowExport({
      name: 'svc',
      config: { url: 'http://example/mcp', headers: {} },
    }) as Record<string, unknown>
    expect(a['bizData']).toEqual({ url: 'http://example/mcp', headers: {} })
    expect(a['config']).toBeUndefined()
    expect(a['name']).toBe('svc')
  })
})

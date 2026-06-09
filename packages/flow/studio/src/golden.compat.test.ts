import { describe, expect, test } from 'bun:test'
import { CustomComponentTemplatesService } from '@cube-ai/flow-core'
import { FlowComponentService, type FlowComponentCatalogItem } from './compile/flow-component.service'
import {
  agentCompanionLlmNodeId,
  smartRouterCompanionLlmNodeId,
  type FlowRuntimeContext,
} from './compile/flow-runtime-mapper'
import { FlowService } from './flow.service'

/**
 * WS6 golden 兼容性对表（ADR-0014 验收）。
 *
 * 对 agent / smart-router / 多模态 / 文生图 / knowledge-retrieval 各取一例 editorFlowJson，
 * 跑 flow-studio 编译器（`buildCubeFlowGraph`，走真实 builtin 组件目录），断言：
 * 1. 产物为 DSL v2 `CubeFlowGraph`（schemaVersion=1、节点/边齐备、无 unsupportedNodes）；
 * 2. 每个内联 `cube_dsl` 自定义组件 DSL 均被 flow-core `CustomComponentTemplatesService.validateDsl`
 *    （= `buildCubeComponentSchemaFromDslPayload`）接受 —— 即进程内引擎可消费。
 */

interface CompiledGraph {
  schemaVersion: number
  nodes: Array<Record<string, unknown>>
  edges: Array<Record<string, unknown>>
}

// validateDsl 仅做纯 schema 校验，不触达仓储，传入空仓储即可。
const templates = new CustomComponentTemplatesService({} as never)

function flowService(): FlowService {
  return new FlowService(
    {} as never,
    {} as never,
    {} as never,
    new FlowComponentService({} as never),
    {} as never,
    {} as never,
    {} as never,
  )
}

async function compileFull(
  editorFlowJson: NonNullable<Parameters<FlowService['createFlow']>[0]['editorFlowJson']>,
  runtimeContext: FlowRuntimeContext,
): Promise<{ graph: CompiledGraph; unsupportedNodes: unknown[] }> {
  const service = flowService()
  const componentSvc = new FlowComponentService({} as never)
  const componentMap = await componentSvc.getCatalogMap(editorFlowJson.nodes.map((n) => n.componentKey))
  return (service as unknown as {
    buildCubeFlowGraph: (
      editorFlow: typeof editorFlowJson,
      componentMap: Map<string, FlowComponentCatalogItem>,
      runtimeContext: FlowRuntimeContext,
    ) => { graph: CompiledGraph; unsupportedNodes: unknown[] }
  }).buildCubeFlowGraph(editorFlowJson, componentMap, runtimeContext)
}

/** 断言图为 DSL v2 且全部内联 cube_dsl 通过 flow-core 校验，返回带 cube_dsl 的节点数。 */
function assertCompatible(graph: CompiledGraph): number {
  expect(graph.schemaVersion).toBe(1)
  expect(Array.isArray(graph.nodes)).toBe(true)
  let dslNodes = 0
  for (const node of graph.nodes) {
    const config = (node.config ?? {}) as Record<string, unknown>
    const dsl = config.cube_dsl
    if (dsl != null) {
      dslNodes += 1
      expect(() => templates.validateDsl(dsl)).not.toThrow()
    }
  }
  return dslNodes
}

const OPENAI_LM_RUNTIME = {
  providerType: 'openai_compatible' as const,
  apiBaseUrl: 'https://api.example.com/v1',
  chatUrl: 'https://api.example.com/v1/chat/completions',
  apiKey: 'sk-test',
  modelCode: 'gpt-4o',
  supportsMultimodalInput: true,
}

describe('flow-studio golden compatibility (editorFlowJson → CubeFlowGraph → flow-core accept)', () => {
  test('多模态 / language-model: hidden merge + language-model DSL accepted by flow-core', async () => {
    const { graph, unsupportedNodes } = await compileFull(
      {
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
          { id: 'llm-1', componentKey: 'language-model', position: { x: 240, y: 0 }, data: { config: { modelId: 'm1', systemMessage: 'You are helpful.' } } },
        ],
        edges: [
          { id: 'e1', source: 'chat-1', target: 'llm-1', sourcePort: 'o-message', targetPort: 'i-input' },
        ],
        metadata: {},
      },
      { languageModelRuntimeByNodeId: new Map([['llm-1', OPENAI_LM_RUNTIME]]) },
    )
    expect(unsupportedNodes).toHaveLength(0)
    const dslNodes = assertCompatible(graph)
    expect(dslNodes).toBeGreaterThanOrEqual(1)
  })

  test('knowledge-retrieval: runtime json uses kb-core doc id (identity) + selfBaseUrl/systemApiKey callback, accepted by flow-core', async () => {
    const { graph, unsupportedNodes } = await compileFull(
      {
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          {
            id: 'node-kr',
            componentKey: 'knowledge-retrieval',
            position: { x: 120, y: 80 },
            data: { config: { documentIds: ['kb-doc-1'], topK: 4 } },
          },
        ],
        edges: [],
        metadata: {},
      },
      {
        knowledgeDocumentRuntimeIds: new Map([['kb-doc-1', 'kb-doc-1']]),
        aiCenterBaseUrl: 'https://ai-center.internal',
        aiCenterApiKey: 'sk_cube_builtin_system',
        aiCenterProjectId: '1001',
      },
    )
    expect(unsupportedNodes).toHaveLength(0)
    const krNode = graph.nodes.find((n) => n.id === 'node-kr')
    expect(krNode).toBeTruthy()
    const config = (krNode!.config ?? {}) as Record<string, unknown>
    expect(krNode!.cubeType).toBe('cube.lf.CustomComponent')
    expect(config.knowledge_sources_runtime_json).toBe(
      JSON.stringify([{ document_id: 'kb-doc-1', top_k: 4, min_score: 0.4 }]),
    )
    // 回调凭据来自忠实路径（selfBaseUrl + builtinSystemApiKey），编译期写入 cube_dsl。
    expect(JSON.stringify(config)).toContain('ai-center.internal')
    assertCompatible(graph)
  })

  test('文生图 / image-generation: dashscope DSL + generation url accepted by flow-core', async () => {
    const { graph, unsupportedNodes } = await compileFull(
      {
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          {
            id: 'node-img',
            componentKey: 'image-generation',
            position: { x: 0, y: 0 },
            data: { config: { modelId: 'img-1', prompt: 'a cat' } },
          },
        ],
        edges: [],
        metadata: {},
      },
      {
        imageGenerationRuntimeByNodeId: new Map([
          [
            'node-img',
            {
              providerType: 'dashscope_text2image',
              apiBaseUrl: 'https://dashscope.aliyuncs.com',
              generationUrl: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
              apiKey: 'sk-test',
              modelCode: 'qwen-image-2.0-pro',
            },
          ],
        ]),
      },
    )
    expect(unsupportedNodes).toHaveLength(0)
    const imgNode = graph.nodes.find((n) => n.id === 'node-img')
    expect(imgNode).toBeTruthy()
    expect(imgNode!.cubeType).toBe('cube.lf.CustomComponent')
    expect(((imgNode!.config ?? {}) as Record<string, unknown>).generation_url).toBe(
      'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
    )
    expect(assertCompatible(graph)).toBeGreaterThanOrEqual(1)
  })

  test('smart-router: routes + companion language-model DSL accepted by flow-core', async () => {
    const routerId = 'router-1'
    const { graph, unsupportedNodes } = await compileFull(
      {
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
          {
            id: routerId,
            componentKey: 'smart-router',
            position: { x: 240, y: 0 },
            data: {
              config: {
                modelId: 'm1',
                routes: [
                  { name: '路由A', description: '问候' },
                  { name: '路由B', description: '其它' },
                ],
              },
            },
          },
        ],
        edges: [
          { id: 'e1', source: 'chat-1', target: routerId, sourcePort: 'o-message', targetPort: 'i-input' },
        ],
        metadata: {},
      },
      { languageModelRuntimeByNodeId: new Map([[smartRouterCompanionLlmNodeId(routerId), OPENAI_LM_RUNTIME]]) },
    )
    expect(unsupportedNodes).toHaveLength(0)
    expect(assertCompatible(graph)).toBeGreaterThanOrEqual(1)
  })

  test('agent: system prompt + companion language-model DSL accepted by flow-core', async () => {
    const agentId = 'agent-1'
    const { graph, unsupportedNodes } = await compileFull(
      {
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
          {
            id: agentId,
            componentKey: 'agent',
            position: { x: 240, y: 0 },
            data: { config: { modelId: 'm1', systemPrompt: 'You are an agent.' } },
          },
        ],
        edges: [
          { id: 'e1', source: 'chat-1', target: agentId, sourcePort: 'o-message', targetPort: 'i-input' },
        ],
        metadata: {},
      },
      { languageModelRuntimeByNodeId: new Map([[agentCompanionLlmNodeId(agentId), OPENAI_LM_RUNTIME]]) },
    )
    expect(unsupportedNodes).toHaveLength(0)
    expect(assertCompatible(graph)).toBeGreaterThanOrEqual(1)
  })
})

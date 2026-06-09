import { describe, expect, mock, test } from 'bun:test'
import { FlowService } from './flow.service'
import type { FlowComponentCatalogItem } from './compile/flow-component.service'
import type { FlowRuntimeContext } from './compile/flow-runtime-mapper'

/**
 * WS3 编译算法回归（「编译算法零改」保证，ADR-0014 D1）。
 *
 * 仅覆盖纯编译路径（`buildCubeFlowGraph` / `buildCompiledFlow` / `ensureLanguageModelCubeAiTemplates`），
 * 不依赖租户上下文或进程内引擎。saveFlow 远端同步图对比（synced graph）属 golden 兼容性 → WS6；
 * 控制器测试 → WS4。
 */
interface SyncedGraphPayload {
  nodes: Array<Record<string, unknown>>
  edges?: Array<Record<string, unknown>>
}

describe('FlowService compile core', () => {
  function makeFlowService(): FlowService {
    return new FlowService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    )
  }

  function catalogItem(
    componentKey: string,
    mappingTarget: string,
    protocolSchema: Record<string, unknown>,
  ): FlowComponentCatalogItem {
    return {
      id: `builtin:${componentKey}`,
      componentKey,
      componentName: componentKey,
      componentGroup: 'test',
      componentType: 'processor',
      componentVersion: '1.0.0',
      mappingType: 'direct-node',
      mappingTarget,
      iconUrl: null,
      enabled: true,
      isBuiltin: true,
      presentationSchema: { fields: [] },
      protocolSchema,
      executionPolicy: null,
    }
  }

  function compileGraphForTest(
    editorFlowJson: Parameters<FlowService['createFlow']>[0]['editorFlowJson'],
    componentMap = new Map<string, FlowComponentCatalogItem>([
      ['chat-input', catalogItem('chat-input', 'cube.lf.ChatInput', { inputs: [], outputs: ['message'] })],
      ['prompt-template', catalogItem('prompt-template', 'cube.lf.Prompt Template', { inputs: [], outputs: ['prompt'] })],
      ['notify', catalogItem('notify', 'cube.lf.Notify', { inputs: ['message'], outputs: ['result'] })],
      ['language-model', catalogItem('language-model', 'cube.lf.CustomComponent', { inputs: ['input'], outputs: ['message'] })],
    ]),
    runtimeContext: FlowRuntimeContext = {},
  ): SyncedGraphPayload {
    const service = makeFlowService()
    const compiled = (service as unknown as {
      buildCubeFlowGraph: (
        editorFlow: NonNullable<Parameters<FlowService['createFlow']>[0]['editorFlowJson']>,
        componentMap: Map<string, FlowComponentCatalogItem>,
        runtimeContext?: FlowRuntimeContext,
      ) => { graph: SyncedGraphPayload }
    }).buildCubeFlowGraph(editorFlowJson!, componentMap, runtimeContext)
    return compiled.graph
  }

  test('compile injects hidden multimodal merge for any-length ChatInput ancestor chain before language-model', () => {
    const graph = compileGraphForTest({
      schemaVersion: 'ai-application-flow/v1',
      nodes: [
        { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'middle-1', componentKey: 'prompt-template', position: { x: 240, y: 0 }, data: { config: { template: '${input}' } } },
        { id: 'middle-2', componentKey: 'notify', position: { x: 480, y: 0 }, data: { config: {} } },
        { id: 'llm-1', componentKey: 'language-model', position: { x: 720, y: 0 }, data: { config: {} } },
      ],
      edges: [
        { id: 'e-chat-middle1', source: 'chat-1', target: 'middle-1', sourcePort: 'o-message', targetPort: 'i-input' },
        { id: 'e-middle1-middle2', source: 'middle-1', target: 'middle-2', sourcePort: 'o-prompt', targetPort: 'i-message' },
        { id: 'e-middle2-llm', source: 'middle-2', target: 'llm-1', sourcePort: 'o-result', targetPort: 'i-input' },
      ],
      metadata: {},
    }, undefined, {
      languageModelRuntimeByNodeId: new Map([
        [
          'llm-1',
          {
            providerType: 'openai_compatible',
            apiBaseUrl: 'https://api.example.com/v1',
            chatUrl: 'https://api.example.com/v1/chat/completions',
            apiKey: 'sk-test',
            modelCode: 'gpt-4o',
            supportsMultimodalInput: true,
          },
        ],
      ]),
    })

    const mergeNode = graph.nodes.find((node) => String(node.id).startsWith('__aiapp_mm_merge__chat-1__llm-1'))
    expect(mergeNode).toBeTruthy()
    if (!mergeNode) {
      return
    }
    expect(mergeNode.cubeType).toBe('cube.lf.CustomComponent')
    const dsl = (mergeNode.config as Record<string, unknown>).cube_dsl as Record<string, unknown>
    expect((dsl.metadata as { name?: string }).name).toBe('AiApplicationMultimodalMessageMerge')
    expect(((dsl.workflow as { blocks?: Array<{ action?: string }> }).blocks ?? [])[0]?.action).toBe('message_merge')

    const edges = graph.edges ?? []
    expect(edges.some((edge) => edge.id === 'e-middle2-llm')).toBe(false)
    expect(edges.some((edge) => edge.source === 'chat-1' && edge.target === mergeNode.id && String(edge.targetPort).endsWith('/original_message'))).toBe(true)
    expect(edges.some((edge) => edge.source === 'middle-2' && edge.target === mergeNode.id && String(edge.targetPort).endsWith('/text'))).toBe(true)
    expect(edges.some((edge) => edge.source === mergeNode.id && edge.target === 'llm-1' && String(edge.targetPort).endsWith('/input'))).toBe(true)
  })

  test('compile does not inject hidden multimodal merge for non-vision language-model', () => {
    const graph = compileGraphForTest({
      schemaVersion: 'ai-application-flow/v1',
      nodes: [
        { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'middle-1', componentKey: 'prompt-template', position: { x: 240, y: 0 }, data: { config: { template: '${input}' } } },
        { id: 'llm-1', componentKey: 'language-model', position: { x: 480, y: 0 }, data: { config: {} } },
      ],
      edges: [
        { id: 'e-chat-middle', source: 'chat-1', target: 'middle-1', sourcePort: 'o-message', targetPort: 'i-input' },
        { id: 'e-middle-llm', source: 'middle-1', target: 'llm-1', sourcePort: 'o-prompt', targetPort: 'i-input' },
      ],
      metadata: {},
    }, undefined, {
      languageModelRuntimeByNodeId: new Map([
        [
          'llm-1',
          {
            providerType: 'openai_compatible',
            apiBaseUrl: 'https://api.example.com/v1',
            chatUrl: 'https://api.example.com/v1/chat/completions',
            apiKey: 'sk-test',
            modelCode: 'gpt-4o-mini',
            supportsMultimodalInput: false,
          },
        ],
      ]),
    })

    expect(graph.nodes.some((node) => String(node.id).startsWith('__aiapp_mm_merge__'))).toBe(false)
    expect((graph.edges ?? []).some((edge) => edge.id === 'e-middle-llm')).toBe(true)
  })

  test('compile keeps direct ChatInput to language-model path without hidden merge', () => {
    const graph = compileGraphForTest({
      schemaVersion: 'ai-application-flow/v1',
      nodes: [
        { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'llm-1', componentKey: 'language-model', position: { x: 240, y: 0 }, data: { config: {} } },
      ],
      edges: [
        { id: 'e-chat-llm', source: 'chat-1', target: 'llm-1', sourcePort: 'o-message', targetPort: 'i-input' },
      ],
      metadata: {},
    })

    expect(graph.nodes.some((node) => String(node.id).startsWith('__aiapp_mm_merge__'))).toBe(false)
    expect((graph.edges ?? []).some((edge) => edge.id === 'e-chat-llm')).toBe(true)
  })

  test('compile rejects ambiguous multimodal source when one language-model has multiple ChatInput ancestors', () => {
    expect(() =>
      compileGraphForTest({
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          { id: 'chat-a', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
          { id: 'chat-b', componentKey: 'chat-input', position: { x: 0, y: 120 }, data: { config: {} } },
          { id: 'middle-1', componentKey: 'notify', position: { x: 260, y: 0 }, data: { config: {} } },
          { id: 'llm-1', componentKey: 'language-model', position: { x: 520, y: 0 }, data: { config: {} } },
        ],
        edges: [
          { id: 'e-a-middle', source: 'chat-a', target: 'middle-1', sourcePort: 'o-message', targetPort: 'i-message' },
          { id: 'e-b-middle', source: 'chat-b', target: 'middle-1', sourcePort: 'o-message', targetPort: 'i-message' },
          { id: 'e-middle-llm', source: 'middle-1', target: 'llm-1', sourcePort: 'o-result', targetPort: 'i-input' },
        ],
        metadata: {},
      }, undefined, {
        languageModelRuntimeByNodeId: new Map([
          [
            'llm-1',
            {
              providerType: 'openai_compatible',
              apiBaseUrl: 'https://api.example.com/v1',
              chatUrl: 'https://api.example.com/v1/chat/completions',
              apiKey: 'sk-test',
              modelCode: 'gpt-4o',
              supportsMultimodalInput: true,
            },
          ],
        ]),
      }),
    ).toThrow('多模态输入来源不唯一')
  })

  test('compile warns when ChatInput reaches non-vision language-model because images will be ignored', async () => {
    const service = new FlowService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        findByIdForTenant: mock(async () => ({
          id: 'model-text-1',
          tenant: 1001,
          tenant_provider_id: 'provider-openai-1',
          system_model_id: null,
          model_code: 'gpt-4-text',
          display_name: 'GPT Text',
          group_name: 'Text',
          sort_order: '1',
          remark: null,
          icon_url: null,
          api_base_url: null,
          endpoint_type: 'openai',
          request_schema_json: null,
          response_schema_json: null,
          dsl_schema_json: '{"nodeKind":"language_model"}',
          model_types: 'reasoning,tool',
          is_free: false,
          supports_test: true,
        })),
      } as never,
      {
        findByIdForTenant: mock(async () => ({
          id: 'provider-openai-1',
          tenant: 1001,
          provider_code: 'openai',
          type_code: 'openai',
          name: 'OpenAI',
          api_base_url: 'https://api.example.com/v1',
          api_key: 'sk-test',
          enabled: true,
          remark: null,
          icon_url: null,
        })),
      } as never,
      {} as never,
    )
    const componentMap = new Map<string, FlowComponentCatalogItem>([
      ['chat-input', catalogItem('chat-input', 'cube.lf.ChatInput', { inputs: [], outputs: ['message'] })],
      ['prompt-template', catalogItem('prompt-template', 'cube.lf.Prompt Template', { inputs: ['input'], outputs: ['prompt'] })],
      ['language-model', catalogItem('language-model', 'cube.lf.CustomComponent', { inputs: ['input'], outputs: ['message'] })],
    ])

    const compiled = await (service as unknown as {
      buildCompiledFlow: (
        editorFlow: NonNullable<Parameters<FlowService['createFlow']>[0]['editorFlowJson']>,
        componentMap: Map<string, FlowComponentCatalogItem>,
      ) => Promise<{ extraIssues: Array<{ code: string; level: string; message: string; nodeId?: string }> }>
    }).buildCompiledFlow({
      schemaVersion: 'ai-application-flow/v1',
      nodes: [
        { id: 'chat-1', componentKey: 'chat-input', position: { x: 0, y: 0 }, data: { config: {} } },
        { id: 'prompt-1', componentKey: 'prompt-template', position: { x: 240, y: 0 }, data: { config: { template: '${input}' } } },
        { id: 'llm-text-1', componentKey: 'language-model', position: { x: 480, y: 0 }, data: { config: { modelId: 'model-text-1' } } },
      ],
      edges: [
        { id: 'e-chat-prompt', source: 'chat-1', target: 'prompt-1', sourcePort: 'o-message', targetPort: 'i-input' },
        { id: 'e-prompt-llm', source: 'prompt-1', target: 'llm-text-1', sourcePort: 'o-prompt', targetPort: 'i-input' },
      ],
      metadata: {},
    }, componentMap)

    expect(compiled.extraIssues).toContainEqual({
      code: 'FLOW_MULTIMODAL_INPUT_IGNORED',
      level: 'warning',
      message: '当前语言模型不具备视觉输入能力；如果 ChatInput 上传了图片，图片不会传入该模型',
      nodeId: 'llm-text-1',
    })
  })

  test('language model template upsert separates text and vision DSL templates', async () => {
    const createCustomComponentTemplate = mock(async ({ displayName, dsl }: { displayName: string; dsl: Record<string, unknown> }) => {
      const input = (dsl.inputs as Array<{ kind?: string }>)[0]
      return { id: `${displayName.includes('Vision') ? 'vision' : 'text'}-${input?.kind}` }
    })
    const service = makeFlowService()
    const result = await (service as unknown as {
      ensureLanguageModelCubeAiTemplates: (
        client: {
          validateCustomComponentTemplateDsl: (body: { dsl: Record<string, unknown> }) => Promise<unknown>
          listCustomComponentTemplates: () => Promise<{ templates: Array<{ id?: string; displayName?: string }> }>
          createCustomComponentTemplate: (body: { displayName: string; dsl: Record<string, unknown> }) => Promise<{ id?: string }>
        },
        editorFlow: NonNullable<Parameters<FlowService['createFlow']>[0]['editorFlowJson']>,
        languageModelRuntimeByNodeId: FlowRuntimeContext['languageModelRuntimeByNodeId'],
      ) => Promise<Record<string, string | undefined>>
    }).ensureLanguageModelCubeAiTemplates(
      {
        validateCustomComponentTemplateDsl: mock(async () => ({})),
        listCustomComponentTemplates: mock(async () => ({ templates: [] })),
        createCustomComponentTemplate,
      },
      {
        schemaVersion: 'ai-application-flow/v1',
        nodes: [
          { id: 'llm-text', componentKey: 'language-model', data: { config: { modelId: 'm-text' } } },
          { id: 'llm-vision', componentKey: 'language-model', data: { config: { modelId: 'm-vision' } } },
        ],
        edges: [],
        metadata: {},
      },
      new Map([
        [
          'llm-text',
          {
            providerType: 'openai_compatible',
            apiBaseUrl: 'https://api.example.com/v1',
            chatUrl: 'https://api.example.com/v1/chat/completions',
            apiKey: 'sk-test',
            modelCode: 'gpt-text',
            supportsMultimodalInput: false,
          },
        ],
        [
          'llm-vision',
          {
            providerType: 'openai_compatible',
            apiBaseUrl: 'https://api.example.com/v1',
            chatUrl: 'https://api.example.com/v1/chat/completions',
            apiKey: 'sk-test',
            modelCode: 'gpt-vision',
            supportsMultimodalInput: true,
          },
        ],
      ]),
    )

    expect(result.openaiText).toBe('text-message_text')
    expect(result.openaiVision).toBe('vision-handle')
    expect(createCustomComponentTemplate).toHaveBeenCalledTimes(2)
  })
})

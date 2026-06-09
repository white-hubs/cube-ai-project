import type { CubeFlowNode } from '@cube-ai/flow-core'
import type { FlowComponentCatalogItem } from './flow-component.service'
import type { FlowEditorNode } from '../types'
import type { LlmRequestSchema, LlmResponseSchema } from '@cube-ai/llm-core'
import {
  resolveEnableThinkingField,
  resolveEnableThinkingWirePath,
  resolveEnableThinkingWireTransform,
} from './llm-wire-adapter/transforms/extra-body-merge'
import { resolveWireSize } from './llm-wire-adapter/transforms/size-transform'
import type { ChannelProfile } from './llm-wire-adapter/wire-context.types'

const CUSTOM_COMPONENT_DSL_KEY = 'cube_dsl'
export const MULTIMODAL_MESSAGE_MERGE_COMPONENT_KEY = 'multimodal-message-merge'
const MULTIMODAL_IMAGE_MAX_FILE_BYTES = 20 * 1024 * 1024

/** 与 `@cube-ai/shared` 的 `CUBE_CUSTOM_TEMPLATE_ID_KEY` 一致；节点指向 cube-ai 模板库记录 */
export const CUBE_CUSTOM_TEMPLATE_ID_KEY = 'cube_custom_template_id'

/** 与 ai-application 画布 types/flow 一致；AI Center 画连线桩位依赖节点 width/height，写死 240×112 会导致 Chat 卡片区桩与边几何错位 */
export const FLOW_CHAT_CARD_WIDTH = 271
export const FLOW_CHAT_CARD_HEIGHT = 92
export const FLOW_LLM_NODE_WIDTH = 280
export const FLOW_LLM_NODE_HEIGHT = 96
export const FLOW_DEFAULT_NODE_WIDTH = 240
export const FLOW_DEFAULT_NODE_HEIGHT = 112
/** 与流程编辑器画布 `flow-node-prompt-template` 一致，供 AI Center 边桩布局 */
export const FLOW_PROMPT_TEMPLATE_NODE_WIDTH = 280
export const FLOW_PROMPT_TEMPLATE_NODE_HEIGHT = 174
/** 与画布 `flow-node-knowledge-retrieval` 卡片一致（未选知识库时的最小高度） */
export const FLOW_KNOWLEDGE_RETRIEVAL_NODE_WIDTH = 280
export const FLOW_KNOWLEDGE_RETRIEVAL_NODE_HEIGHT = 58
export const FLOW_SMART_ROUTER_NODE_WIDTH = 280
export const FLOW_SMART_ROUTER_NODE_HEIGHT = 216
/** 与画布 flow-node-agent 一致（与语言模型节点同高，收紧底部留白） */
export const FLOW_AGENT_NODE_WIDTH = 280
export const FLOW_AGENT_NODE_HEIGHT = 96

/** 与 cube-ai `@cube-ai/shared` AGENT_LLM_CONNECT_OTHER 一致：外接 LanguageModel */
export const AGENT_LLM_CONNECT_OTHER = 'connect_other_models' as const

/**
 * 编辑器/DSL 中变量占位为 `${name}`；cube-ai 侧为单花括号 `{name}`。
 * 仅用于编译推送到 cube 的节点 config，不修改编辑器持久化内容。
 *
 * 兼容：`$` 与 `{` 之间有空格、全角 `＄`、全角花括号（先归一化再替换）。
 */
export function cubeAiTemplateFromEditorTemplate(template: unknown): string {
  if (typeof template !== 'string') {
    return ''
  }
  let s = template
  s = s.replace(/\uFF04/g, '$')
  s = s.replace(/\uFF5B/g, '{').replace(/\uFF5D/g, '}')
  return s.replace(/\$\s*\{\s*([^}]*?)\s*\}/g, (_m, inner: string) => {
    const name = String(inner).trim()
    if (name === '') {
      return ''
    }
    return `{${name}}`
  })
}

/** 从编辑器节点 config 中取模板原文（cube-ai 同步前统一映射占位符） */
function readPromptTemplateRawText(config: Record<string, unknown>): string | undefined {
  if (typeof config.template === 'string') {
    return config.template
  }
  if (typeof config.prompt_template === 'string') {
    return config.prompt_template
  }
  const camel = (config as { promptTemplate?: unknown }).promptTemplate
  if (typeof camel === 'string') {
    return camel
  }
  return undefined
}

/**
 * 推送到 cube-ai / Langflow 的提示词模板 config：写回 `template` 与 `prompt_template`（远端组件常读 snake_case）。
 */
export function buildPromptTemplateCubeConfig(base: Record<string, unknown>): Record<string, unknown> {
  const raw = readPromptTemplateRawText(base)
  if (raw === undefined) {
    return { ...base }
  }
  const mapped = cubeAiTemplateFromEditorTemplate(raw)
  return {
    ...base,
    template: mapped,
    prompt_template: mapped,
  }
}

export function cubeNodeDimensionsForComponentKey(componentKey: string): { width: number; height: number } {
  if (componentKey === 'chat-input' || componentKey === 'chat-output') {
    return { width: FLOW_CHAT_CARD_WIDTH, height: FLOW_CHAT_CARD_HEIGHT }
  }
  if (componentKey === 'language-model' || componentKey === 'image-generation') {
    return { width: FLOW_LLM_NODE_WIDTH, height: FLOW_LLM_NODE_HEIGHT }
  }
  if (componentKey === 'prompt-template') {
    return { width: FLOW_PROMPT_TEMPLATE_NODE_WIDTH, height: FLOW_PROMPT_TEMPLATE_NODE_HEIGHT }
  }
  if (componentKey === 'smart-router') {
    return { width: FLOW_SMART_ROUTER_NODE_WIDTH, height: FLOW_SMART_ROUTER_NODE_HEIGHT }
  }
  if (componentKey === 'agent') {
    return { width: FLOW_AGENT_NODE_WIDTH, height: FLOW_AGENT_NODE_HEIGHT }
  }
  if (componentKey === 'knowledge-retrieval') {
    return { width: FLOW_KNOWLEDGE_RETRIEVAL_NODE_WIDTH, height: FLOW_KNOWLEDGE_RETRIEVAL_NODE_HEIGHT }
  }
  if (componentKey === 'mcp') {
    return { width: FLOW_DEFAULT_NODE_WIDTH, height: FLOW_DEFAULT_NODE_HEIGHT }
  }
  return { width: FLOW_DEFAULT_NODE_WIDTH, height: FLOW_DEFAULT_NODE_HEIGHT }
}

/**
 * 生成 lfNodeId 短码：普通 UUID 取去连字符后的前 6 位。
 * 伴侣 / MCP 注入节点 id 带固定前缀 `__aiapp_*__`，若直接取前 6 位会得到同一串 `__aiap`，
 * 导致多种伴侣 CustomComponent 在 cube-ai 侧共用一个 lfNodeId，边与 chat_url 全部错乱——须先剥前缀再取 UUID 段。
 *
 * 前缀须与 `smartRouterCompanionLlmNodeId` / `agentCompanionLlmNodeId` / `agentCompanionMcpNodeId` 一致。
 */
function lfGraphNodeShortIdSuffix(graphNodeId: string): string {
  const compact = graphNodeId.replace(/-/g, '')
  const syntheticPrefixes = ['__aiapp_sr_llm__', '__aiapp_agent_llm__', '__aiapp_agent_mcp__', '__aiapp_mm_merge__']
  for (const p of syntheticPrefixes) {
    if (compact.startsWith(p)) {
      const rest = compact.slice(p.length)
      if (rest.length >= 6) {
        return rest.slice(0, 6).toLowerCase()
      }
      return compact.slice(-6).toLowerCase()
    }
  }
  return compact.slice(0, 6).toLowerCase()
}

/**
 * cube-ai / AI Center 边的 sourcePort/targetPort 形如 cube.sp/o/{lfNodeId}/message，
 * 其中 lfNodeId 须与节点上 lfNodeId 一致（如 ChatInput-a1b2c3），不能使用图节点 UUID。
 */
export function lfNodeIdForCubeGraphNode(cubeType: string, graphNodeId: string): string {
  const segments = cubeType.trim().split('.')
  const rawLeaf = segments.length > 0 ? (segments[segments.length - 1] ?? 'Node') : 'Node'
  const leaf = rawLeaf.replace(/[^a-zA-Z0-9_]/g, '') || 'Node'
  const short = lfGraphNodeShortIdSuffix(graphNodeId)
  return `${leaf}-${short}`
}

/** 生成 lfNodeId 所用的 cube 类型：优先 catalog mappingTarget，否则按内置物料回退，避免仅有 componentKey（如 chat-input）时 leaf 被错误清洗 */
const BUILTIN_MAPPING_TARGET_FOR_LF_ID: Record<string, string> = {
  'chat-input': 'cube.lf.ChatInput',
  'chat-output': 'cube.lf.ChatOutput',
  agent: 'cube.lf.Agent',
  /** compile 注入：仅在 cube-ai 图中存在，画布不出现 */
  mcp: 'cube.lf.MCPTools',
  [MULTIMODAL_MESSAGE_MERGE_COMPONENT_KEY]: 'cube.lf.CustomComponent',
  'knowledge-retrieval': 'cube.lf.KnowledgeRetrieval',
  'language-model': 'cube.lf.CustomComponent',
  'image-generation': 'cube.lf.CustomComponent',
  'prompt-template': 'cube.lf.Prompt Template',
}

function cubeTypeStringForLfNodeId(
  component: FlowComponentCatalogItem | undefined,
  componentKey: string,
): string {
  const mt = component?.mappingTarget?.trim()
  if (mt) {
    return mt
  }
  return BUILTIN_MAPPING_TARGET_FOR_LF_ID[componentKey] ?? 'cube.lf.Node'
}
const AI_CENTER_BASE_URL_PLACEHOLDER = '__AI_CENTER_BASE_URL__'
const AI_CENTER_API_KEY_PLACEHOLDER = '__AI_CENTER_API_KEY__'
const AI_CENTER_PROJECT_ID_PLACEHOLDER = '__AI_CENTER_PROJECT_ID__'

/** 未解析租户 LLM 端点时编译占位（同步前 cube_dsl 已生成，真实 URL/密钥在同步时再次写入） */
export const AI_APPLICATION_LLM_CHAT_URL_PLACEHOLDER = '__AI_APPLICATION_LLM_CHAT_URL__'
export const AI_APPLICATION_LLM_API_KEY_PLACEHOLDER = '__AI_APPLICATION_LLM_API_KEY__'
export const AI_APPLICATION_IMAGE_GEN_URL_PLACEHOLDER = '__AI_APPLICATION_IMAGE_GEN_URL__'
export const AI_APPLICATION_IMAGE_GEN_API_KEY_PLACEHOLDER = '__AI_APPLICATION_IMAGE_GEN_API_KEY__'

/**
 * 与 HTTP chat/completions 同一逻辑地址：仅暴露 `chat_url` 一处；此处从 `chat_url` 推导 LangChain `base_url`（含 `/chat/completions` 则去掉该后缀，否则视为已是 base）。
 * Langflow 运行环境需具备 langchain_openai。
 */
const OPENAI_COMPAT_TENANT_LM_ASSIGN_EXPR =
  "__import__('langchain_openai', fromlist=['ChatOpenAI']).ChatOpenAI(model=str(self.model_code or ''), api_key=str(self.api_key or ''), base_url=((_u := str(self.chat_url or '').strip()) and (_u.rsplit('/chat/completions', 1)[0].rstrip('/') if '/chat/completions' in _u else _u.rstrip('/'))))"

/** Azure：`chat_url` 形如 `{endpoint}/openai/deployments/{dep}/chat/completions?...`，取 endpoint 段。 */
const AZURE_OPENAI_TENANT_LM_ASSIGN_EXPR =
  "__import__('langchain_openai', fromlist=['AzureChatOpenAI']).AzureChatOpenAI(azure_endpoint=((_u := str(self.chat_url or '').strip()) and (_u.split('/openai/deployments/', 1)[0].rstrip('/') if '/openai/deployments/' in _u else '')), api_key=str(self.api_key or ''), api_version='2024-10-21', deployment_name=str(self.model_code or ''))"

const TEXT_ONLY_USER_CONTENT_EXPR =
  '(lambda v: "\\n".join([str((p or {}).get("text") or "") for p in v if isinstance(p, dict) and (p or {}).get("text")]) if isinstance(v, list) else ("" if v is None else str(v)))(getattr(self.input, "text", None) or getattr(self.input, "content", None) or ((self.input.get("text") or self.input.get("content") or self.input.get("message")) if isinstance(self.input, dict) else None) or self.input)'

const LANGUAGE_MODEL_THINKING_PATCH_EXPR =
  '((lambda _path, _transform, _enabled: ({"thinking": {"type": ("enabled" if _enabled else "disabled")}} if (_path == "thinking.type" or _transform == "boolean:enabled_disabled") else ({"enable_thinking": _enabled} if (_path == "enable_thinking" or _path == "extra_body.enable_thinking") else {})))(str(getattr(self, \'thinking_wire_path\', \'\') or \'enable_thinking\'), str(getattr(self, \'thinking_wire_transform\', \'\') or \'\'), bool(getattr(self, \'enable_thinking\', False))))'

function openaiChatApiErrorDetailBodyExpr(): string {
  return `str((((_p or {}).get("error") or {}).get("message") if isinstance(_p, dict) and isinstance((_p or {}).get("error"), dict) else None) or ((_p or {}).get("message") if isinstance(_p, dict) and (_p or {}).get("message") else None) or (str(_r).strip()[:800] if isinstance(_r, str) and str(_r).strip() else None) or (str(_p)[:800] if isinstance(_p, dict) and _p else "empty response"))`
}

export function openaiChatMessageContentExpr(payloadRef: string, rawRef: string): string {
  return `(lambda _p, _r: (lambda _choices: (lambda _content: (_content if isinstance(_content, str) else (json.dumps(_content, ensure_ascii=False) if _content is not None else "")))((((_choices[0] or {}).get("message") or {}).get("content") if isinstance(_choices[0], dict) else None)) if isinstance(_choices, list) and len(_choices) > 0 else (_ for _ in ()).throw(RuntimeError("Chat Completions API failed: " + ${openaiChatApiErrorDetailBodyExpr()})))((_p or {}).get("choices") if isinstance(_p, dict) else None))(${payloadRef}, ${rawRef})`
}

interface LanguageModelDslOptions {
  supportsMultimodalInput?: boolean
  supportsEnableThinking?: boolean
  useEnableThinking?: boolean
  enableThinking?: boolean
  thinkingWirePath?: string
  thinkingWireTransform?: string
}

function languageModelSupportsMultimodalInput(rt: LanguageModelRuntimeConfig | undefined): boolean {
  return rt != null && rt.providerType !== 'unsupported' && rt.supportsMultimodalInput === true
}

export type LanguageModelRuntimeConfig =
  | {
      providerType: 'openai_compatible'
      /** 租户供应商配置的 API Base URL（与 chatUrl 区分：后者多为 Base + /chat/completions） */
      apiBaseUrl: string
      chatUrl: string
      apiKey: string | null
      modelCode: string
      requestSchema?: LlmRequestSchema | null
      responseSchema?: LlmResponseSchema | null
      nativeFamily?: string | null
      channelProfile?: ChannelProfile | null
      adapterKey?: string | null
      supportsMultimodalInput?: boolean
    }
  | {
      providerType: 'azure_openai'
      apiBaseUrl: string
      chatUrl: string
      apiKey: string | null
      modelCode: string
      requestSchema?: LlmRequestSchema | null
      responseSchema?: LlmResponseSchema | null
      nativeFamily?: string | null
      channelProfile?: ChannelProfile | null
      adapterKey?: string | null
      supportsMultimodalInput?: boolean
    }
  | { providerType: 'unsupported'; reason: string }

export type ImageGenerationRuntimeConfig =
  | {
      providerType: 'dashscope_text2image'
      apiBaseUrl: string
      generationUrl: string
      apiKey: string | null
      modelCode: string
      requestSchema?: LlmRequestSchema | null
      responseSchema?: LlmResponseSchema | null
      nativeFamily?: string | null
      channelProfile?: ChannelProfile | null
      adapterKey?: string | null
    }
  | {
      providerType: 'openai_image'
      apiBaseUrl: string
      generationUrl: string
      apiKey: string | null
      modelCode: string
      requestSchema?: LlmRequestSchema | null
      responseSchema?: LlmResponseSchema | null
      nativeFamily?: string | null
      channelProfile?: ChannelProfile | null
      adapterKey?: string | null
    }
  | { providerType: 'unsupported'; reason: string }

export interface FlowRuntimeContext {
  aiCenterBaseUrl?: string | null
  aiCenterApiKey?: string | null
  aiCenterProjectId?: string | null
  knowledgeDocumentRuntimeIds?: Map<string, string>
  languageModelRuntimeByNodeId?: Map<string, LanguageModelRuntimeConfig>
  imageGenerationRuntimeByNodeId?: Map<string, ImageGenerationRuntimeConfig>
  /** sync 阶段由业务写入：cube-ai 自定义组件模板 id（OpenAI 兼容 / Azure 两套） */
  languageModelCubeAiTemplateIds?: {
    openaiText?: string
    openaiVision?: string
    azureText?: string
    azureVision?: string
    /** 兼容旧运行上下文；新逻辑优先使用 openaiText/openaiVision */
    openai?: string
    /** 兼容旧运行上下文；新逻辑优先使用 azureText/azureVision */
    azure?: string
  }
  imageGenerationCubeAiTemplateIds?: { dashscope?: string; openai?: string }
}

/**
 * OpenAI Images API 生成地址。
 * - OpenAI 官方：{base}/v1/images/generations
 * - 火山方舟（base 已含 /api/v3）：{base}/images/generations
 */
export function resolveOpenAiImagesGenerationUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, '')
  if (base.endsWith('/images/generations')) {
    return base
  }
  if (base.endsWith('/api/v3')) {
    return `${base}/images/generations`
  }
  if (base.endsWith('/v1')) {
    return `${base}/images/generations`
  }
  return `${base}/v1/images/generations`
}

export function buildRuntimeNode(
  node: FlowEditorNode,
  component: FlowComponentCatalogItem | undefined,
  runtimeContext: FlowRuntimeContext,
): CubeFlowNode {
  const baseConfig = parseNodeConfig(node)
  const { width, height } = cubeNodeDimensionsForComponentKey(node.componentKey)
  const cubeType = component?.mappingTarget ?? node.componentKey
  const lfNodeId = lfNodeIdForCubeGraphNode(cubeTypeStringForLfNodeId(component, node.componentKey), node.id)
  if (node.componentKey === MULTIMODAL_MESSAGE_MERGE_COMPONENT_KEY) {
    return {
      id: node.id,
      lfNodeId,
      cubeType: 'cube.lf.CustomComponent',
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      config: {
        [CUSTOM_COMPONENT_DSL_KEY]: buildMultimodalMessageMergeDsl(),
      },
    }
  }
  if (node.componentKey === 'knowledge-retrieval') {
    return buildKnowledgeRetrievalNode(
      node,
      runtimeContext,
      baseConfig,
      FLOW_KNOWLEDGE_RETRIEVAL_NODE_WIDTH,
      measureKnowledgeRetrievalNodeHeightFromEditorConfig(baseConfig),
      lfNodeId,
    )
  }
  if (node.componentKey === 'language-model') {
    return buildLanguageModelNode(node, runtimeContext, baseConfig, width, height, lfNodeId)
  }
  if (node.componentKey === 'image-generation') {
    return buildImageGenerationNode(node, runtimeContext, baseConfig, width, height, lfNodeId)
  }
  if (node.componentKey === 'prompt-template') {
    return {
      id: node.id,
      lfNodeId,
      cubeType,
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      config: buildPromptTemplateCubeConfig(baseConfig),
    }
  }
  if (node.componentKey === 'smart-router') {
    return {
      id: node.id,
      lfNodeId,
      cubeType,
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      config: buildSmartRouterCubeConfig(node.id, baseConfig),
    }
  }
  if (node.componentKey === 'agent') {
    return {
      id: node.id,
      lfNodeId,
      cubeType,
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      config: buildAgentCubeConfig(node.id, baseConfig),
    }
  }
  if (node.componentKey === 'mcp') {
    const mcpMapping = component?.mappingTarget?.trim()
    const mcpCubeType = mcpMapping !== '' && mcpMapping != null ? mcpMapping : 'cube.lf.MCPTools'
    return {
      id: node.id,
      lfNodeId,
      cubeType: mcpCubeType,
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      /**
       * cube-ai `graph-translator`：`fieldUi.nodeToolMode === true` → LF `tool_mode`，进而 `normalizeLfAgentToolModeOutputs`
       * 输出 **component_as_tool**，供 Agent `tools` 边；并走 Toolset 分支（`applyMcpToolsLangflowToolsetModeTemplate`、Push 前 listTools enrich）。
       * 勿省略：否则 MCPTools 仍为多输出/非 Toolset，工具链与 Agent 对不齐。
       */
      config: baseConfig,
      fieldUi: { nodeToolMode: true },
    }
  }
  return {
    id: node.id,
    lfNodeId,
    cubeType,
    x: Number(node.position?.x ?? 0),
    y: Number(node.position?.y ?? 0),
    width,
    height,
    config: baseConfig,
  }
}

function parseNodeConfig(node: FlowEditorNode): Record<string, unknown> {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {}
  }
  const config = (data as Record<string, unknown>).config
  if (config && typeof config === 'object' && !Array.isArray(config)) {
    return config as Record<string, unknown>
  }
  return data as Record<string, unknown>
}

const SMART_ROUTER_COMPANION_LLM_PREFIX = '__aiapp_sr_llm__'

export function smartRouterCompanionLlmNodeId(routerId: string): string {
  return `${SMART_ROUTER_COMPANION_LLM_PREFIX}${routerId}`
}

/** 仅服务端 expand 注入的智能路由伴侣 LLM；画布上不展示该节点（见方案：编辑一张图，同步时拆成 SmartRouter + LLM）。 */
export function isSmartRouterCompanionLanguageModelNodeId(nodeId: string): boolean {
  return nodeId.startsWith(SMART_ROUTER_COMPANION_LLM_PREFIX)
}

const AGENT_COMPANION_LLM_PREFIX = '__aiapp_agent_llm__'

export function agentCompanionLlmNodeId(agentGraphNodeId: string): string {
  return `${AGENT_COMPANION_LLM_PREFIX}${agentGraphNodeId}`
}

const AGENT_COMPANION_MCP_PREFIX = '__aiapp_agent_mcp__'

/** compile 注入 MCP→Agent 的合成边 id 前缀（与 flow.ts 持久化过滤一致） */
export const AGENT_MCP_SYNTHETIC_EDGE_PREFIX = '__aiapp_agent_mcp_edge__'

export function agentCompanionMcpNodeId(agentGraphNodeId: string): string {
  return `${AGENT_COMPANION_MCP_PREFIX}${agentGraphNodeId}`
}

export function isAgentCompanionMcpNodeId(nodeId: string): boolean {
  return nodeId.startsWith(AGENT_COMPANION_MCP_PREFIX)
}

export function isAgentCompanionLanguageModelNodeId(nodeId: string): boolean {
  return nodeId.startsWith(AGENT_COMPANION_LLM_PREFIX)
}

/** cube-ai 智能路由模型输入字段名（与 `cube.lf.SmartRouter` 模板一致） */
export const CUBE_SMART_ROUTER_MODEL_INPUT = 'model'

/** Cube 语义：Agent 外接 LanguageModel（cube-ai 字段 `agent_llm`） */
export const CUBE_AGENT_MODEL_INPUT = 'agent_llm'

/**
 * cube-ai 智能路由路由表列：route_category、route_description、output_value。
 * 编辑器侧 route_name / route_message 映射到上述字段。
 */
function normalizeSmartRouterRoutesForCube(routesInput: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(routesInput) || routesInput.length === 0) {
    return [
      {
        route_category: '路由 1',
        route_description: '',
        output_value: '',
      },
    ]
  }
  return routesInput.map((item, idx) => {
    const o = item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {}
    const routeCategory =
      typeof o.route_category === 'string' && o.route_category.trim() !== ''
        ? o.route_category.trim()
        : typeof o.route_name === 'string'
          ? o.route_name
          : `路由 ${idx + 1}`
    const routeDescription = typeof o.route_description === 'string' ? o.route_description : ''
    const outputValue =
      typeof o.output_value === 'string'
        ? o.output_value
        : typeof o.route_message === 'string'
          ? o.route_message
          : ''
    return {
      route_category: routeCategory,
      route_description: routeDescription,
      output_value: outputValue,
    }
  })
}

/**
 * 推送 cube-ai 时保证 `routes` 行数不少于出线所占用的最大分类序号，否则远端节点动态出口数少于边上的语义端口。
 */
export function padSmartRouterCubeConfigRoutesMinRows(
  baseConfig: Record<string, unknown>,
  minRows: number,
): Record<string, unknown> {
  const normalized = normalizeSmartRouterRoutesForCube(baseConfig.routes)
  if (minRows <= normalized.length) {
    return { ...baseConfig, routes: normalized }
  }
  const padded = [...normalized]
  while (padded.length < minRows) {
    const nextNum = padded.length + 1
    padded.push({
      route_category: `路由 ${nextNum}`,
      route_description: '',
      output_value: '',
    })
  }
  return { ...baseConfig, routes: padded }
}

export function extractSmartRouterCompanionLlmEditorConfig(routerConfig: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set(['routes', 'custom_prompt'])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(routerConfig)) {
    if (skip.has(k)) {
      continue
    }
    out[k] = v
  }
  return out
}

/**
 * 整理 `mcp_server` 字段：供 **cube-ai** 侧 `cube.lf.MCPTools` 节点 `config` 使用（经 AI Center `updateFlow` 入库）。
 * 约定以 cube-ai 流程引擎为准。
 */
export function normalizeMcpServerValueForCubeExport(val: unknown): unknown {
  if (val == null || typeof val !== 'object' || Array.isArray(val)) {
    return val
  }
  const o = { ...(val as Record<string, unknown>) }
  const bd = o.bizData
  if (bd != null && typeof bd === 'object' && !Array.isArray(bd)) {
    delete o.config
    return o
  }
  const cfg = o.config
  if (cfg != null && typeof cfg === 'object' && !Array.isArray(cfg)) {
    delete o.config
    o.bizData = { ...(cfg as Record<string, unknown>) }
  }
  return o
}

/** 解析 Agent 面板 MCP 配置；须含 `bizData.url` 才在 compile 时注入 MCPTools */
export function parseAgentMcpServiceConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  const raw = config.mcpServiceConfig
  let parsed: unknown
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t === '') {
      return null
    }
    try {
      parsed = JSON.parse(t) as unknown
    } catch {
      return null
    }
  } else if (raw != null && typeof raw === 'object' && !Array.isArray(raw)) {
    parsed = raw
  } else {
    return null
  }
  if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  const obj = parsed as Record<string, unknown>
  const bizRaw = obj.bizData
  const biz =
    bizRaw != null && typeof bizRaw === 'object' && !Array.isArray(bizRaw) ? (bizRaw as Record<string, unknown>) : null
  const url = biz?.url
  if (typeof url !== 'string' || url.trim() === '') {
    return null
  }
  return obj
}

/**
 * 生成 Agent 伴生 `cube.lf.MCPTools` 的 `CubeFlowNode.config`（类型见 `@ghcloud/ai-center-sdk` 的 `CubeFlowNode`）。
 * 字段集合与 snake_case 命名以 **cube-ai** 对该 preset 的读写为准；动态工具列表可由 cube-ai 写入 `mcpDynamicSchemaInputs`，本服务同步时不填充该字段。
 */
export function buildMcpToolsSyntheticCubeConfigFromAgentPayload(parsed: Record<string, unknown>): Record<string, unknown> {
  const name =
    typeof parsed.name === 'string' && parsed.name.trim() !== '' ? parsed.name.trim() : 'ai-application-mcp'
  const bizRaw = parsed.bizData
  const bizData =
    bizRaw != null && typeof bizRaw === 'object' && !Array.isArray(bizRaw)
      ? ({ ...(bizRaw as Record<string, unknown>) } as Record<string, unknown>)
      : {}
  const tool = typeof parsed.tool === 'string' ? parsed.tool.trim() : ''
  const mcp_server = normalizeMcpServerValueForCubeExport({ name, bizData })
  return {
    /** 与 cube-ai `MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS` 及 `fieldUi.nodeToolMode` 语义一致，供仅读 config 的路径 */
    tool_mode: true,
    mcp_server,
    tool,
    use_cache: false,
    verify_ssl: true,
  }
}

/** 伴侣节点仅需租户模型相关字段；指令与语言留在 Agent 节点 config */
export function extractAgentCompanionLlmEditorConfig(agentConfig: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set([
    'routes',
    'systemPrompt',
    'system_prompt',
    'n_messages',
    'nMessages',
    'max_iterations',
    'maxIterations',
    'add_current_date_tool',
    'addCurrentDateTool',
    'agentLanguage',
    'mcpServiceConfig',
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(agentConfig)) {
    if (skip.has(k)) {
      continue
    }
    out[k] = v
  }
  return out
}

function agentPositiveInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  const n = Math.floor(value)
  if (n < min) {
    return undefined
  }
  return Math.min(n, max)
}

function agentNonNegativeInt(value: unknown): number | undefined {
  return agentPositiveInt(value, 0, 10000)
}

export function buildAgentCubeConfig(agentGraphNodeId: string, config: Record<string, unknown>): Record<string, unknown> {
  const companionLf = lfNodeIdForCubeGraphNode(
    BUILTIN_MAPPING_TARGET_FOR_LF_ID['language-model'] ?? 'cube.lf.CustomComponent',
    agentCompanionLlmNodeId(agentGraphNodeId),
  )
  const systemPrompt =
    typeof config.systemPrompt === 'string'
      ? config.systemPrompt
      : typeof config.system_prompt === 'string'
        ? config.system_prompt
        : ''
  const n_messages = agentNonNegativeInt(config.n_messages ?? config.nMessages)
  const max_iterations = agentPositiveInt(config.max_iterations ?? config.maxIterations, 1, 500)
  const add_current_date_tool =
    typeof config.add_current_date_tool === 'boolean'
      ? config.add_current_date_tool
      : typeof config.addCurrentDateTool === 'boolean'
        ? config.addCurrentDateTool
        : undefined

  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (
      k === 'modelId' ||
      k === 'selectedModelLabel' ||
      k === 'selectedModelGroupTag' ||
      k === 'selectedModelIconUrl' ||
      k === 'systemPrompt' ||
      k === 'system_prompt' ||
      k === 'n_messages' ||
      k === 'nMessages' ||
      k === 'max_iterations' ||
      k === 'maxIterations' ||
      k === 'add_current_date_tool' ||
      k === 'addCurrentDateTool' ||
      k === 'agentLanguage' ||
      k === 'mcpServiceConfig'
    ) {
      continue
    }
    rest[k] = v
  }
  const out: Record<string, unknown> = {
    ...rest,
    system_prompt: systemPrompt,
    agent_llm: AGENT_LLM_CONNECT_OTHER,
    model: AGENT_LLM_CONNECT_OTHER,
    model_lf_node_id: companionLf,
  }
  if (n_messages !== undefined) {
    out.n_messages = n_messages
  }
  if (max_iterations !== undefined) {
    out.max_iterations = max_iterations
  }
  if (add_current_date_tool !== undefined) {
    out.add_current_date_tool = add_current_date_tool
  }
  return out
}

function buildSmartRouterCubeConfig(routerGraphNodeId: string, config: Record<string, unknown>): Record<string, unknown> {
  const routes = normalizeSmartRouterRoutesForCube(config.routes)
  const companionLf = lfNodeIdForCubeGraphNode(
    BUILTIN_MAPPING_TARGET_FOR_LF_ID['language-model'] ?? 'cube.lf.CustomComponent',
    smartRouterCompanionLlmNodeId(routerGraphNodeId),
  )
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(config)) {
    if (k === 'routes' || k === 'modelId') {
      continue
    }
    if (k === 'selectedModelLabel' || k === 'selectedModelGroupTag' || k === 'selectedModelIconUrl') {
      continue
    }
    rest[k] = v
  }
  return {
    ...rest,
    routes,
    /** 便于 cube-ai 排查边未生成时对照；主线仍以 compile 边为准 */
    model_lf_node_id: companionLf,
  }
}

const KNOWLEDGE_RETRIEVAL_DEFAULT_SCORE_THRESHOLD = 0.4

function normalizeScoreThreshold(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(n)) {
    return KNOWLEDGE_RETRIEVAL_DEFAULT_SCORE_THRESHOLD
  }
  const c = Math.min(Math.max(n, 0), 1)
  return Math.round(c * 10) / 10
}

const KNOWLEDGE_RETRIEVAL_TOPK_MAX = 20

function normalizeTopK(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 5
  }
  return Math.min(Math.round(numeric), KNOWLEDGE_RETRIEVAL_TOPK_MAX)
}

/** 画布 knowledgeSources / 旧版 documentIds+topK → 统一结构（租户侧文档业务 id） */
export function normalizeEditorKnowledgeSources(config: Record<string, unknown>): Array<{
  bizId: string
  topK: number
  minScore: number
}> {
  const raw = config.knowledgeSources
  if (Array.isArray(raw) && raw.length > 0) {
    const out: Array<{ bizId: string; topK: number; minScore: number }> = []
    for (const item of raw) {
      if (item == null || typeof item !== 'object' || Array.isArray(item)) {
        continue
      }
      const o = item as Record<string, unknown>
      const bizId = typeof o.documentId === 'string' ? o.documentId.trim() : ''
      if (bizId === '') {
        continue
      }
      out.push({
        bizId,
        topK: normalizeTopK(o.topK ?? o.top_k),
        minScore: normalizeScoreThreshold(o.scoreThreshold ?? o.min_score ?? o.minSimilarity),
      })
    }
    return out
  }
  const ids = normalizeStringArray(config.documentIds)
  const legacyTopK = normalizeTopK(config.topK)
  const legacyScore = normalizeScoreThreshold(config.scoreThreshold ?? config.minScore ?? config.min_similarity)
  return ids.map((bizId) => ({
    bizId,
    topK: legacyTopK,
    minScore: legacyScore,
  }))
}

/** 须与 ai-application `nodes.ts` 知识检索卡片堆叠行几何一致 */
const FLOW_KR_CONTENT_TOP = 44
const FLOW_KR_ROW_H = 30
const FLOW_KR_ROW_GAP = 6
const FLOW_KR_BOTTOM_PAD = 14
const FLOW_KR_MAX_ROWS = 20

function measureKnowledgeRetrievalNodeHeightFromEditorConfig(config: Record<string, unknown>): number {
  const n = Math.min(normalizeEditorKnowledgeSources(config).length, FLOW_KR_MAX_ROWS)
  if (n === 0) {
    return FLOW_KR_CONTENT_TOP + FLOW_KR_BOTTOM_PAD
  }
  return FLOW_KR_CONTENT_TOP + n * FLOW_KR_ROW_H + (n - 1) * FLOW_KR_ROW_GAP + FLOW_KR_BOTTOM_PAD
}

function omitKnowledgeRetrievalEditorOnlyKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const skip = new Set([
    'documentIds',
    'knowledgeSources',
    'topK',
    'scoreThreshold',
    'minScore',
    'min_similarity',
  ])
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg)) {
    if (!skip.has(k)) {
      out[k] = v
    }
  }
  return out
}

function buildKnowledgeRetrievalNode(
  node: FlowEditorNode,
  runtimeContext: FlowRuntimeContext,
  config: Record<string, unknown>,
  width: number,
  height: number,
  lfNodeId: string,
): CubeFlowNode {
  const editorSources = normalizeEditorKnowledgeSources(config)
  const runtimeRows = editorSources.map((s) => ({
    document_id: runtimeContext.knowledgeDocumentRuntimeIds?.get(s.bizId) ?? s.bizId,
    top_k: s.topK,
    min_score: s.minScore,
  }))
  const apiUrlBase = normalizeOptionalString(runtimeContext.aiCenterBaseUrl) ?? AI_CENTER_BASE_URL_PLACEHOLDER
  const apiKey = normalizeOptionalString(runtimeContext.aiCenterApiKey) ?? AI_CENTER_API_KEY_PLACEHOLDER
  const projectId = normalizeOptionalString(runtimeContext.aiCenterProjectId) ?? AI_CENTER_PROJECT_ID_PLACEHOLDER

  return {
    id: node.id,
    lfNodeId,
    cubeType: 'cube.lf.CustomComponent',
    x: Number(node.position?.x ?? 0),
    y: Number(node.position?.y ?? 0),
    width,
    height,
    config: {
      ...omitKnowledgeRetrievalEditorOnlyKeys(config),
      api_url: `${apiUrlBase.replace(/\/+$/, '')}/search/by-documents`,
      api_key: apiKey,
      project_id: projectId,
      knowledge_sources_runtime_json: JSON.stringify(runtimeRows),
      [CUSTOM_COMPONENT_DSL_KEY]: buildKnowledgeRetrievalDsl(),
    },
  }
}

function buildKnowledgeRetrievalDsl(): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationKnowledgeRetrieval',
      display_name: 'AI Application Knowledge Retrieval',
      description:
        '调用 AI Center POST /search/by-documents：单次请求传入 query 与 documents[]（每项 documentId、topK、similarityThreshold），服务端合并多文档召回结果；合并 items 文本为单一字符串输出。',
      icon: 'search',
      wrap_build_in_try: true,
    },
    inputs: [
      {
        kind: 'message_text',
        name: 'query',
        display_name: 'Query',
        default: '',
        tool_mode: true,
      },
      {
        kind: 'str',
        name: 'api_url',
        display_name: 'API URL',
        required: true,
      },
      {
        kind: 'secret_str',
        name: 'api_key',
        display_name: 'API Key',
        required: true,
      },
      {
        kind: 'str',
        name: 'project_id',
        display_name: 'Project ID',
        required: true,
      },
      {
        kind: 'str',
        name: 'knowledge_sources_runtime_json',
        display_name: 'Knowledge sources JSON',
        required: true,
      },
    ],
    /** cube-ai 仅允许 data|message|text|language_model；用 text 表示合并后的纯文本，勿用 data（结构化） */
    output: {
      kind: 'text',
      method: 'build_output',
      display_name: 'Search results',
      name: 'SEARCH_RESULTS',
      value_from: 'SEARCH_RESULTS',
    },
    workflow: {
      blocks: [
        {
          type: 'op',
          action: 'json_parse',
          params: { from: '{{knowledge_sources_runtime_json}}' },
          output_as: 'sources',
        },
        {
          type: 'op',
          action: 'assign',
          params: { expr: '[]' },
          output_as: 'all_items',
        },
        {
          type: 'if',
          condition: { kind: 'non_empty', field: 'query' },
          // oxlint-disable-next-line unicorn/no-thenable -- DSL v2 约定：if 分支字段名为 then
          then: [
            {
              type: 'op',
              action: 'assign',
              params: {
                /**
                 * 与 ai-center POST /search/by-documents 一致；similarityThreshold 对应画布 min_score（score 语义见 cube-ai kb SearchController）
                 */
                expr: '{"query": (self.query if isinstance(self.query, str) else str(self.query or "")), "documents": [{"documentId": str((d or {}).get("document_id") or ""), "topK": int((d or {}).get("top_k") or 5), "similarityThreshold": float((d or {}).get("min_score") or 0.0)} for d in (sources if isinstance(sources, list) else []) if isinstance(d, dict) and str((d or {}).get("document_id") or "").strip()]}',
              },
              output_as: 'kr_batch_request_body',
            },
            {
              type: 'op',
              action: 'http',
              params: {
                method: 'POST',
                url: '{{api_url}}',
                headers: {
                  'x-api-key': '{{api_key}}',
                  'x-project-id': '{{project_id}}',
                },
                body_type: 'json',
                body: '{{kr_batch_request_body}}',
              },
              output_as: 'raw',
            },
            {
              type: 'op',
              action: 'json_parse',
              params: { from: '{{raw}}' },
              output_as: 'payload',
            },
            {
              type: 'op',
              action: 'assign',
              params: {
                expr: '[x for x in (payload.get("items", []) if isinstance(payload, dict) else []) if isinstance(x, dict)]',
              },
              output_as: 'all_items',
            },
          ],
          else: [
            {
              type: 'op',
              action: 'assign',
              params: { expr: '[]' },
              output_as: 'all_items',
            },
          ],
        },
        {
          type: 'op',
          action: 'assign',
          params: {
            expr: '"\\n\\n".join([str((item or {}).get("text") or "") for item in all_items if (item or {}).get("text")])',
          },
          output_as: 'SEARCH_RESULTS',
        },
      ],
    },
  }
}

export function buildMultimodalMessageMergeDsl(): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationMultimodalMessageMerge',
      display_name: 'AI Application Multimodal Message Merge',
      description: 'Merge transformed text with the original ChatInput Message files before passing into an LLM.',
      icon: 'merge',
      wrap_build_in_try: true,
    },
    inputs: [
      {
        kind: 'message_text',
        name: 'text',
        display_name: 'Text',
        default: '',
        tool_mode: true,
      },
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
          params: {
            text: '{{text}}',
            message: '{{original_message}}',
          },
          output_as: 'merged_message',
        },
      ],
    },
  }
}

/** 与 DSL `inputs[].name === 'input'` 一致；旧画布仅存 userMessage 时视作同一含义 */
function languageModelInputFromEditorConfig(config: Record<string, unknown>): string {
  if (Object.prototype.hasOwnProperty.call(config, 'input')) {
    const raw = config.input
    return typeof raw === 'string' ? raw : String(raw ?? '')
  }
  return normalizeOptionalString(config.userMessage) ?? ''
}

/** 推送 cube-ai 时去掉画布侧的 camelCase，避免与 DSL 的 snake_case（top_p、use_temperature…）并存导致 Langflow 绑定错乱 */
function omitLanguageModelCamelAliases(rest: Record<string, unknown>): Record<string, unknown> {
  const out = { ...rest }
  const strip = [
    'topP',
    'topK',
    'presencePenalty',
    'frequencyPenalty',
    'maxTokens',
    'useTemperature',
    'useTopP',
    'useTopK',
    'usePresencePenalty',
    'useFrequencyPenalty',
    'useMaxTokens',
    'enableThinking',
    'useEnableThinking',
  ] as const
  for (const k of strip) {
    delete out[k]
  }
  return out
}

function buildLanguageModelNode(
  node: FlowEditorNode,
  runtimeContext: FlowRuntimeContext,
  config: Record<string, unknown>,
  width: number,
  height: number,
  lfNodeId: string,
): CubeFlowNode {
  const { userMessage: _legacyUserMessage, ...editorRest } = config
  const editorForCube = omitLanguageModelCamelAliases(editorRest)
  const inputText = languageModelInputFromEditorConfig(config)
  const systemMessage = normalizeOptionalString(config.systemMessage) ?? ''
  const temperature = normalizeTemperature(config.temperature)
  const top_p = normalizeLanguageModelTopP(config.topP ?? config.top_p)
  const top_k = normalizeLanguageModelTopK(config.topK ?? config.top_k)
  const presence_penalty = normalizeLanguageModelPenalty(config.presencePenalty ?? config.presence_penalty)
  const frequency_penalty = normalizeLanguageModelPenalty(config.frequencyPenalty ?? config.frequency_penalty)
  const max_tokens = normalizeLanguageModelMaxTokens(config.maxTokens ?? config.max_tokens)
  const use_temperature = normalizeLanguageModelUseFlag(config.useTemperature ?? config.use_temperature, false)
  const use_top_p = normalizeLanguageModelUseFlag(config.useTopP ?? config.use_top_p, false)
  const use_top_k = normalizeLanguageModelUseFlag(config.useTopK ?? config.use_top_k, false)
  const use_presence_penalty = normalizeLanguageModelUseFlag(
    config.usePresencePenalty ?? config.use_presence_penalty,
    false,
  )
  const use_frequency_penalty = normalizeLanguageModelUseFlag(
    config.useFrequencyPenalty ?? config.use_frequency_penalty,
    false,
  )
  const use_max_tokens = normalizeLanguageModelUseFlag(config.useMaxTokens ?? config.use_max_tokens, false)
  const hasEnableThinkingConfig =
    Object.prototype.hasOwnProperty.call(config, 'enableThinking') ||
    Object.prototype.hasOwnProperty.call(config, 'enable_thinking')
  const enable_thinking = normalizeLanguageModelUseFlag(config.enableThinking ?? config.enable_thinking, false)
  const use_enable_thinking = normalizeLanguageModelUseFlag(
    config.useEnableThinking ?? config.use_enable_thinking,
    hasEnableThinkingConfig,
  )
  const forCompanionLlm =
    isSmartRouterCompanionLanguageModelNodeId(node.id) || isAgentCompanionLanguageModelNodeId(node.id)
  const dslOpenAi = forCompanionLlm
    ? buildLanguageModelDslOpenAiForSmartRouterCompanion({ supportsMultimodalInput: false })
    : buildLanguageModelDslOpenAi({ supportsMultimodalInput: false })

  const rt = runtimeContext.languageModelRuntimeByNodeId?.get(node.id)
  if (!rt || rt.providerType === 'unsupported') {
    const reason =
      rt && rt.providerType === 'unsupported' ? rt.reason : 'language_model_runtime_missing'
    const fallbackCode =
      normalizeOptionalString(config.modelId)?.trim() ||
      normalizeOptionalString((config as { model_code?: unknown }).model_code)?.trim() ||
      'unresolved'
    /**
     * 必须与 cube-ai 可渲染类型一致（cube.lf.*），否则 buildCubeFlowGraph 视其为 unsupported 并阻止 syncRemoteFlow，
     * 导致远端流程画布不更新。端点未解析时仍用 CustomComponent + 占位 + 内联 cube_dsl，运行前需在租户侧补全供应商。
     */
    return {
      id: node.id,
      lfNodeId,
      cubeType: 'cube.lf.CustomComponent',
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      config: {
        ...editorForCube,
        input: inputText,
        chat_url: AI_APPLICATION_LLM_CHAT_URL_PLACEHOLDER,
        api_key: AI_APPLICATION_LLM_API_KEY_PLACEHOLDER,
        model_code: fallbackCode,
        system_message: systemMessage,
        temperature,
        top_p,
        top_k,
        presence_penalty,
        frequency_penalty,
        max_tokens,
        use_temperature,
        use_top_p,
        use_top_k,
        use_presence_penalty,
        use_frequency_penalty,
        use_max_tokens,
        [CUSTOM_COMPONENT_DSL_KEY]: dslOpenAi,
        _unresolved_reason: reason,
      },
    }
  }

  const chatUrl =
    rt.chatUrl.trim() !== ''
      ? rt.chatUrl
      : AI_APPLICATION_LLM_CHAT_URL_PLACEHOLDER
  const apiKey = rt.apiKey ?? AI_APPLICATION_LLM_API_KEY_PLACEHOLDER
  const modelCode = rt.modelCode
  const enableThinkingField =
    rt.providerType === 'openai_compatible' ? resolveEnableThinkingField(rt.requestSchema) : null
  const supports_enable_thinking = enableThinkingField != null
  const thinking_wire_path = resolveEnableThinkingWirePath(enableThinkingField)
  const thinking_wire_transform = resolveEnableThinkingWireTransform(enableThinkingField)
  const supportsMultimodalInput = languageModelSupportsMultimodalInput(rt)
  const dslOptions: LanguageModelDslOptions = {
    supportsMultimodalInput,
    supportsEnableThinking: supports_enable_thinking,
    useEnableThinking: use_enable_thinking,
    enableThinking: enable_thinking,
    thinkingWirePath: thinking_wire_path,
    thinkingWireTransform: thinking_wire_transform,
  }
  const dsl =
    rt.providerType === 'azure_openai'
      ? forCompanionLlm
        ? buildLanguageModelDslAzureForSmartRouterCompanion(dslOptions)
        : buildLanguageModelDslAzure(dslOptions)
      : forCompanionLlm
        ? buildLanguageModelDslOpenAiForSmartRouterCompanion(dslOptions)
        : buildLanguageModelDslOpenAi(dslOptions)

  const templateIds = runtimeContext.languageModelCubeAiTemplateIds
  const templateId =
    rt.providerType === 'azure_openai'
      ? supportsMultimodalInput
        ? (templateIds?.azureVision ?? templateIds?.azure)
        : (templateIds?.azureText ?? templateIds?.azure)
      : supportsMultimodalInput
        ? (templateIds?.openaiVision ?? templateIds?.openai)
        : (templateIds?.openaiText ?? templateIds?.openai)
  /** 思考开关是节点级状态；用内联 DSL 避免通用模板的 False 默认值覆盖当前节点。 */
  const templateIdForNode = supports_enable_thinking ? undefined : templateId

  return {
    id: node.id,
    lfNodeId,
    cubeType: 'cube.lf.CustomComponent',
    x: Number(node.position?.x ?? 0),
    y: Number(node.position?.y ?? 0),
    width,
    height,
    config: {
      ...editorForCube,
      input: inputText,
      chat_url: chatUrl,
      api_key: apiKey,
      model_code: modelCode,
      system_message: systemMessage,
      temperature,
      top_p,
      top_k,
      presence_penalty,
      frequency_penalty,
      max_tokens,
      use_temperature,
      use_top_p,
      use_top_k,
      use_presence_penalty,
      use_frequency_penalty,
      use_max_tokens,
      supports_enable_thinking,
      enable_thinking,
      use_enable_thinking,
      thinking_wire_path,
      thinking_wire_transform,
      [CUSTOM_COMPONENT_DSL_KEY]: dsl,
      ...(templateIdForNode ? { [CUBE_CUSTOM_TEMPLATE_ID_KEY]: templateIdForNode } : {}),
    },
  }
}

/** OpenAI 兼容：单输出 Message（画布「语言模型」节点；cube-ai 模板 upsert 与此一致） */
export function buildLanguageModelDslOpenAi(options: LanguageModelDslOptions = {}): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationLanguageModelOpenAI',
      display_name: 'AI Application Language Model (OpenAI-compatible)',
      description: 'Chat completions against tenant LLM base URL (OpenAI-compatible).',
      icon: 'smart_toy',
      wrap_build_in_try: true,
    },
    inputs: languageModelDslOpenAiInputs(options),
    output: {
      kind: 'message',
      name: 'message',
      method: 'build_output',
      display_name: 'Message',
    },
    workflow: {
      blocks: languageModelOpenAiWorkflowBlocks(false, options),
    },
  }
}

/**
 * 双输出 language_model + message：仅用于服务端注入的 SmartRouter 伴侣节点（`__aiapp_sr_llm__*`），供 Langflow model 口连线。
 */
export function buildLanguageModelDslOpenAiForSmartRouterCompanion(
  options: LanguageModelDslOptions = {},
): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationLanguageModelOpenAIRouterCompanion',
      display_name: 'AI Application Language Model (OpenAI-compatible, SmartRouter)',
      description: 'Chat completions + LanguageModel output for SmartRouter model port.',
      icon: 'smart_toy',
      wrap_build_in_try: true,
    },
    inputs: languageModelDslOpenAiInputs(options),
    outputs: [
      {
        kind: 'language_model',
        name: 'model',
        method: 'build_language_model_output',
        display_name: 'Language Model',
        value_from: 'tenant_lm',
      },
      {
        kind: 'message',
        name: 'message',
        method: 'build_output',
        display_name: 'Message',
        value_from: 'message',
      },
    ],
    workflow: {
      blocks: languageModelOpenAiWorkflowBlocks(true, options),
    },
  }
}

function languageModelInputField(options: LanguageModelDslOptions): Record<string, unknown> {
  if (options.supportsMultimodalInput === true) {
    return { kind: 'handle', name: 'input', display_name: 'Input', input_types: ['Message'], required: false }
  }
  return { kind: 'message_text', name: 'input', display_name: 'Input', default: '', tool_mode: true }
}

function languageModelDslStringDefault(value: string | undefined, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback
  }
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
}

function languageModelDslOpenAiInputs(options: LanguageModelDslOptions): Array<Record<string, unknown>> {
  return [
    languageModelInputField(options),
    { kind: 'str', name: 'system_message', display_name: 'System', default: '' },
    { kind: 'str', name: 'model_code', display_name: 'Model', required: true },
    { kind: 'str', name: 'chat_url', display_name: 'Chat URL', required: true },
    { kind: 'secret_str', name: 'api_key', display_name: 'API Key' },
    { kind: 'bool', name: 'use_temperature', display_name: 'Use temperature', default: false },
    { kind: 'bool', name: 'use_top_p', display_name: 'Use top_p', default: false },
    { kind: 'bool', name: 'use_top_k', display_name: 'Use top_k', default: false },
    { kind: 'bool', name: 'use_presence_penalty', display_name: 'Use presence_penalty', default: false },
    { kind: 'bool', name: 'use_frequency_penalty', display_name: 'Use frequency_penalty', default: false },
    { kind: 'bool', name: 'use_max_tokens', display_name: 'Use max_tokens', default: false },
    {
      kind: 'bool',
      name: 'supports_enable_thinking',
      display_name: 'Supports enable_thinking',
      default: options.supportsEnableThinking === true,
    },
    {
      kind: 'bool',
      name: 'use_enable_thinking',
      display_name: 'Use enable_thinking',
      default: options.useEnableThinking === true,
    },
    {
      kind: 'bool',
      name: 'enable_thinking',
      display_name: 'Enable thinking',
      default: options.enableThinking === true,
    },
    {
      kind: 'str',
      name: 'thinking_wire_path',
      display_name: 'Thinking wire path',
      default: languageModelDslStringDefault(options.thinkingWirePath, 'enable_thinking'),
    },
    {
      kind: 'str',
      name: 'thinking_wire_transform',
      display_name: 'Thinking wire transform',
      default: languageModelDslStringDefault(options.thinkingWireTransform, ''),
    },
    { kind: 'float', name: 'temperature', display_name: 'Temperature', default: 0.7 },
    { kind: 'float', name: 'top_p', display_name: 'Top P', default: 1 },
    { kind: 'int', name: 'top_k', display_name: 'Top K', default: 1 },
    { kind: 'float', name: 'presence_penalty', display_name: 'Presence Penalty', default: 0 },
    { kind: 'float', name: 'frequency_penalty', display_name: 'Frequency Penalty', default: 0 },
    { kind: 'int', name: 'max_tokens', display_name: 'Max Tokens', default: 512 },
  ]
}

function languageModelUserContentBlock(options: LanguageModelDslOptions): Record<string, unknown> {
  if (options.supportsMultimodalInput === true) {
    return {
      type: 'op',
      action: 'message_to_openai_content',
      params: {
        message: '{{input}}',
        max_file_bytes: MULTIMODAL_IMAGE_MAX_FILE_BYTES,
      },
      output_as: 'user_content',
    }
  }
  return {
    type: 'op',
    action: 'assign',
    params: {
      expr: TEXT_ONLY_USER_CONTENT_EXPR,
    },
    output_as: 'user_content',
  }
}

function languageModelOpenAiWorkflowBlocks(
  includeTenantLm: boolean,
  options: LanguageModelDslOptions,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    languageModelUserContentBlock(options),
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '([{"role":"system","content":str(self.system_message)}] if (self.system_message and str(self.system_message).strip()) else []) + [{"role":"user","content":user_content}]',
      },
      output_as: 'msgs',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          `{**{"model": self.model_code, "messages": msgs}, **({"temperature": float(self.temperature)} if bool(getattr(self, 'use_temperature', False)) else {}), **({"top_p": float(self.top_p)} if bool(getattr(self, 'use_top_p', False)) else {}), **({"top_k": int(self.top_k)} if bool(getattr(self, 'use_top_k', False)) else {}), **({"presence_penalty": float(self.presence_penalty)} if bool(getattr(self, 'use_presence_penalty', False)) else {}), **({"frequency_penalty": float(self.frequency_penalty)} if bool(getattr(self, 'use_frequency_penalty', False)) else {}), **({"max_tokens": int(self.max_tokens)} if bool(getattr(self, 'use_max_tokens', False)) else {}), **(${LANGUAGE_MODEL_THINKING_PATCH_EXPR} if bool(getattr(self, 'supports_enable_thinking', False)) else {})}`,
      },
      output_as: 'request_body',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: '("Bearer " + str(self.api_key)) if self.api_key else ""',
      },
      output_as: 'authorization_header',
    },
    {
      type: 'op',
      action: 'http',
      params: {
        method: 'POST',
        url: '{{chat_url}}',
        timeout_ms: 300000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: '{{authorization_header}}',
        },
        body_type: 'json',
        body: '{{request_body}}',
      },
      output_as: 'raw',
    },
    {
      type: 'op',
      action: 'json_parse',
      params: { from: '{{raw}}' },
      output_as: 'payload',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiChatMessageContentExpr('payload', 'raw'),
      },
      output_as: 'message',
    },
  ]
  if (includeTenantLm) {
    blocks.push({
      type: 'op',
      action: 'assign',
      params: {
        expr: OPENAI_COMPAT_TENANT_LM_ASSIGN_EXPR,
      },
      output_as: 'tenant_lm',
    })
  }
  return blocks
}

/** Azure：单输出 Message（画布语言模型） */
export function buildLanguageModelDslAzure(options: LanguageModelDslOptions = {}): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationLanguageModelAzure',
      display_name: 'AI Application Language Model (Azure OpenAI)',
      description: 'Azure OpenAI chat completions (api-key header).',
      icon: 'smart_toy',
      wrap_build_in_try: true,
    },
    inputs: languageModelDslAzureInputs(options),
    output: {
      kind: 'message',
      name: 'message',
      method: 'build_output',
      display_name: 'Message',
    },
    workflow: {
      blocks: languageModelAzureWorkflowBlocks(false, options),
    },
  }
}

/** Azure 双输出：仅 SmartRouter 伴侣节点 */
export function buildLanguageModelDslAzureForSmartRouterCompanion(
  options: LanguageModelDslOptions = {},
): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationLanguageModelAzureRouterCompanion',
      display_name: 'AI Application Language Model (Azure OpenAI, SmartRouter)',
      description: 'Azure completions + LanguageModel output for SmartRouter model port.',
      icon: 'smart_toy',
      wrap_build_in_try: true,
    },
    inputs: languageModelDslAzureInputs(options),
    outputs: [
      {
        kind: 'language_model',
        name: 'model',
        method: 'build_language_model_output',
        display_name: 'Language Model',
        value_from: 'tenant_lm',
      },
      {
        kind: 'message',
        name: 'message',
        method: 'build_output',
        display_name: 'Message',
        value_from: 'message',
      },
    ],
    workflow: {
      blocks: languageModelAzureWorkflowBlocks(true, options),
    },
  }
}

function languageModelDslAzureInputs(options: LanguageModelDslOptions): Array<Record<string, unknown>> {
  return [
    languageModelInputField(options),
    { kind: 'str', name: 'system_message', display_name: 'System', default: '' },
    { kind: 'str', name: 'model_code', display_name: 'Deployment', required: true },
    { kind: 'str', name: 'chat_url', display_name: 'Chat URL', required: true },
    { kind: 'secret_str', name: 'api_key', display_name: 'API Key' },
    { kind: 'bool', name: 'use_temperature', display_name: 'Use temperature', default: false },
    { kind: 'bool', name: 'use_top_p', display_name: 'Use top_p', default: false },
    { kind: 'bool', name: 'use_top_k', display_name: 'Use top_k', default: false },
    { kind: 'bool', name: 'use_presence_penalty', display_name: 'Use presence_penalty', default: false },
    { kind: 'bool', name: 'use_frequency_penalty', display_name: 'Use frequency_penalty', default: false },
    { kind: 'bool', name: 'use_max_tokens', display_name: 'Use max_tokens', default: false },
    {
      kind: 'bool',
      name: 'supports_enable_thinking',
      display_name: 'Supports enable_thinking',
      default: options.supportsEnableThinking === true,
    },
    {
      kind: 'bool',
      name: 'use_enable_thinking',
      display_name: 'Use enable_thinking',
      default: options.useEnableThinking === true,
    },
    {
      kind: 'bool',
      name: 'enable_thinking',
      display_name: 'Enable thinking',
      default: options.enableThinking === true,
    },
    {
      kind: 'str',
      name: 'thinking_wire_path',
      display_name: 'Thinking wire path',
      default: languageModelDslStringDefault(options.thinkingWirePath, 'enable_thinking'),
    },
    {
      kind: 'str',
      name: 'thinking_wire_transform',
      display_name: 'Thinking wire transform',
      default: languageModelDslStringDefault(options.thinkingWireTransform, ''),
    },
    { kind: 'float', name: 'temperature', display_name: 'Temperature', default: 0.7 },
    { kind: 'float', name: 'top_p', display_name: 'Top P', default: 1 },
    { kind: 'int', name: 'top_k', display_name: 'Top K', default: 1 },
    { kind: 'float', name: 'presence_penalty', display_name: 'Presence Penalty', default: 0 },
    { kind: 'float', name: 'frequency_penalty', display_name: 'Frequency Penalty', default: 0 },
    { kind: 'int', name: 'max_tokens', display_name: 'Max Tokens', default: 512 },
  ]
}

function languageModelAzureWorkflowBlocks(
  includeTenantLm: boolean,
  options: LanguageModelDslOptions,
): Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [
    languageModelUserContentBlock(options),
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '([{"role":"system","content":str(self.system_message)}] if (self.system_message and str(self.system_message).strip()) else []) + [{"role":"user","content":user_content}]',
      },
      output_as: 'msgs',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          `{**{"messages": msgs}, **({"temperature": float(self.temperature)} if bool(getattr(self, 'use_temperature', False)) else {}), **({"top_p": float(self.top_p)} if bool(getattr(self, 'use_top_p', False)) else {}), **({"top_k": int(self.top_k)} if bool(getattr(self, 'use_top_k', False)) else {}), **({"presence_penalty": float(self.presence_penalty)} if bool(getattr(self, 'use_presence_penalty', False)) else {}), **({"frequency_penalty": float(self.frequency_penalty)} if bool(getattr(self, 'use_frequency_penalty', False)) else {}), **({"max_tokens": int(self.max_tokens)} if bool(getattr(self, 'use_max_tokens', False)) else {}), **(${LANGUAGE_MODEL_THINKING_PATCH_EXPR} if bool(getattr(self, 'supports_enable_thinking', False)) else {})}`,
      },
      output_as: 'request_body',
    },
    {
      type: 'op',
      action: 'http',
      params: {
        method: 'POST',
        url: '{{chat_url}}',
        timeout_ms: 300000,
        headers: {
          'Content-Type': 'application/json',
          'api-key': '{{api_key}}',
        },
        body_type: 'json',
        body: '{{request_body}}',
      },
      output_as: 'raw',
    },
    {
      type: 'op',
      action: 'json_parse',
      params: { from: '{{raw}}' },
      output_as: 'payload',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiChatMessageContentExpr('payload', 'raw'),
      },
      output_as: 'message',
    },
  ]
  if (includeTenantLm) {
    blocks.push({
      type: 'op',
      action: 'assign',
      params: {
        expr: AZURE_OPENAI_TENANT_LM_ASSIGN_EXPR,
      },
      output_as: 'tenant_lm',
    })
  }
  return blocks
}

function normalizeTemperature(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(numeric)) {
    return 0.7
  }
  return Math.min(Math.max(numeric, 0), 1)
}

function normalizeLanguageModelUseFlag(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null) {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (value === false || value === 0 || value === '0' || value === 'false') {
    return false
  }
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return true
  }
  return defaultValue
}

function normalizeLanguageModelTopP(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(numeric)) {
    return 1
  }
  return Math.min(Math.max(numeric, 0), 1)
}

function normalizeLanguageModelTopK(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric)) {
    return 1
  }
  return Math.min(Math.max(Math.round(numeric), 1), 100)
}

function normalizeLanguageModelPenalty(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  if (!Number.isFinite(numeric)) {
    return 0
  }
  const clamped = Math.min(Math.max(numeric, -2), 2)
  return Math.round(clamped * 10) / 10
}

function normalizeLanguageModelMaxTokens(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(numeric)) {
    return 512
  }
  return Math.min(Math.max(Math.round(numeric), 1), 128000)
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => String(item).trim()).filter((item) => item !== '')
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function imageGenerationPromptFromEditorConfig(config: Record<string, unknown>): string {
  if (Object.prototype.hasOwnProperty.call(config, 'prompt')) {
    const raw = config.prompt
    return typeof raw === 'string' ? raw : String(raw ?? '')
  }
  return ''
}

/**
 * Python expr：从 DashScope 文生图响应取图片 URL。
 * 同步 multimodal：`output.choices[0].message.content[*].image`；异步回退：`output.image_url`。
 */
export function dashscopeImageUrlFromPayloadExpr(payloadRef: string): string {
  return `(lambda _p: ("" if not isinstance(_p, dict) else (lambda _out: ((lambda _flat: _flat if _flat else (lambda _choices: (lambda _c0: (next((str((part or {}).get("image") or (part or {}).get("image_url") or "").strip() for part in ((((_c0 or {}).get("message") or {}) if isinstance(_c0, dict) else {}).get("content") or []) if isinstance(part, dict) and str((part or {}).get("image") or (part or {}).get("image_url") or "").strip()), "") if isinstance(_c0, dict) else ""))((_choices[0] if isinstance(_choices, list) and len(_choices) > 0 else None) if isinstance(_choices, list) else None))((_out or {}).get("choices") if isinstance(_out, dict) else None)))(str((_out or {}).get("image_url") or "").strip() if isinstance(_out, dict) and isinstance((_out or {}).get("image_url"), str) else ""))((_p or {}).get("output") if isinstance(_p, dict) else None) or ""))(${payloadRef})`
}

/** Langflow ChatOutput 渲染图片：Message.text 使用 Markdown 图片语法 */
export function dashscopeImageMessageMarkdownExpr(imageUrlRef = 'image_url'): string {
  return `(('![Generated image](' + str(${imageUrlRef}).strip() + ')') if isinstance(${imageUrlRef}, str) and str(${imageUrlRef}).strip() else "")`
}

/** Python expr：读取组件 api_key（兼容 SecretStr / 普通字符串） */
export function openaiApiKeyPlainExpr(): string {
  return '((self.api_key.get_secret_value() if hasattr(self.api_key, "get_secret_value") else None) or (self.api_key if isinstance(self.api_key, str) else str(self.api_key or "")))'
}

/** Python expr：Authorization Bearer 头 */
export function openaiApiKeyBearerExpr(): string {
  return `(lambda _k: ("Bearer " + str(_k).strip()) if str(_k).strip() else "")(${openaiApiKeyPlainExpr()})`
}

/** Python expr：从 OpenAI Images API 响应取图片 URL（data[0].url） */
export function openaiImageUrlFromPayloadExpr(payloadRef: string): string {
  return `(lambda _p: ("" if not isinstance(_p, dict) else (lambda _data: (str((_data[0] if isinstance(_data, list) and len(_data) > 0 else {}).get("url") or "").strip() if isinstance(_data, list) else ""))((_p or {}).get("data") if isinstance(_p, dict) else None) or ""))(${payloadRef})`
}

/** Python expr：校验 Images API 响应为 dict */
export function openaiImagePayloadMustBeDictExpr(payloadRef: string): string {
  return `(lambda _p: (_p if isinstance(_p, dict) else (_ for _ in ()).throw(RuntimeError("OpenAI Images API returned non-JSON response"))))(${payloadRef})`
}

/** Python expr：从响应取 data[0] 项 */
export function openaiImageItemFromPayloadExpr(payloadRef: string): string {
  return `(lambda _p: ((((_p or {}).get("data") or [None])[0]) if isinstance(_p, dict) and isinstance((_p or {}).get("data"), list) and len((_p or {}).get("data") or []) > 0 else None))(${payloadRef})`
}

/** Python expr：从 data[0] 取 url 或 b64_json 转 data URI */
export function openaiImageSrcFromItemExpr(itemRef: string): string {
  return `(lambda _it: ((str((_it or {}).get("url") or "").strip()) or (("data:image/png;base64," + str((_it or {}).get("b64_json") or "").strip()) if str((_it or {}).get("b64_json") or "").strip() else "")))(${itemRef})`
}

/** Python expr：generation_url 与 api_key 已注入（非占位符）时为 "ready"，否则跳过 HTTP（Langflow 构建阶段） */
export function openaiImageHttpReadyFlagExpr(): string {
  const keyExpr = openaiApiKeyPlainExpr()
  return `("ready" if (bool(str(self.generation_url or "").strip()) and "__AI_APPLICATION_IMAGE_GEN_URL__" not in str(self.generation_url or "") and bool(str((${keyExpr}) or "").strip()) and "__AI_APPLICATION_IMAGE_GEN_API_KEY__" not in str((${keyExpr}) or "")) else "")`
}

/** Python expr：POST Images API，返回响应文本（4xx/5xx 抛错，避免 cube-ai http 块空体） */
export function openaiImageHttpRequestRawExpr(): string {
  return `(lambda: (lambda _resp: (_ for _ in ()).throw(RuntimeError("OpenAI Images HTTP " + str(_resp.status_code) + ": " + str(_resp.text or "")[:800])) if int(getattr(_resp, "status_code", 0) or 0) >= 400 else (str(_resp.text or "") if hasattr(_resp, "text") else str(_resp or "")))(__import__("requests").request("POST", str(self.generation_url or "").strip(), headers={"Content-Type": "application/json", "Authorization": str(authorization_header)}, json=request_body, timeout=300)))()`
}

/** Python expr：OpenAI Images HTTP 响应体转 dict（空体保留 _http_error，非法 JSON 由 json.loads 抛出） */
export function openaiImageParseHttpResponseExpr(rawRef: string): string {
  return `(lambda _r: (_r if isinstance(_r, dict) else ((__import__('json').loads(str(_r).strip()) if isinstance(_r, str) and str(_r).strip() else {"_http_error": "empty HTTP response", "_http_body": (str(_r)[:200] if _r is not None else "")}))))(${rawRef})`
}

/** Python 片段：在含 _p/_r 的 lambda 内拼接 API 错误详情 */
function openaiImageApiErrorDetailBodyExpr(): string {
  return `str((((_p or {}).get("error") or {}).get("message") if isinstance(_p, dict) and isinstance((_p or {}).get("error"), dict) else None) or ((_p or {}).get("message") if isinstance(_p, dict) and (_p or {}).get("message") else None) or ((_p or {}).get("_http_error") if isinstance(_p, dict) and (_p or {}).get("_http_error") else None) or ((_p or {}).get("_http_body") if isinstance(_p, dict) and (_p or {}).get("_http_body") else None) or (str(_r).strip()[:800] if isinstance(_r, str) and str(_r).strip() else None) or (str(_p)[:800] if isinstance(_p, dict) and _p else "unknown error"))`
}

/** Python expr：从 payload / 原始 HTTP 文本提取可读错误信息 */
export function openaiImageApiErrorDetailExpr(payloadRef: string, rawRef: string): string {
  return `(lambda _p, _r: (${openaiImageApiErrorDetailBodyExpr()}))(${payloadRef}, ${rawRef})`
}

/**
 * Python expr：由图片源生成 Markdown；无图时抛出含 API error.message 的异常。
 * 与 {@link openaiImageSrcFromItemExpr} 配合使用，避免单层嵌套 lambda 括号不匹配。
 */
export function openaiImageMarkdownFromSrcAndPayloadExpr(
  srcRef: string,
  payloadRef: string,
  rawRef: string,
  readyFlagRef: string,
): string {
  return `(lambda _src, _p, _r, _ready: (('![Generated image](' + str(_src).strip() + ')') if isinstance(_src, str) and str(_src).strip() else ("" if str(_ready or "").strip() != "ready" else (_ for _ in ()).throw(RuntimeError('OpenAI Images API failed: ' + ${openaiImageApiErrorDetailBodyExpr()})))))(${srcRef}, ${payloadRef}, ${rawRef}, ${readyFlagRef})`
}

/** 构建阶段 HTTP 可能为空；避免 json_parse 对空串 json.loads 导致 build_output 失败 */
export function safeJsonPayloadFromRawExpr(rawRef: string): string {
  return `(lambda _r: (__import__('json').loads(_r) if isinstance(_r, str) and _r.strip() else (_r if isinstance(_r, dict) else {})))(${rawRef})`
}

function imageGenerationMessageOutput(): Record<string, unknown> {
  return {
    kind: 'message',
    name: 'imageUrl',
    method: 'build_output',
    display_name: 'Image',
  }
}

export function buildImageGenerationDslDashscope(): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationImageGenerationDashscope',
      display_name: 'AI Application Image Generation (DashScope)',
      description:
        'DashScope multimodal text-to-image: sync image in output.choices[].message.content[].image; optional task polling fallback.',
      icon: 'image',
      wrap_build_in_try: true,
    },
    inputs: [
      { kind: 'message_text', name: 'prompt', display_name: 'Prompt', default: '', tool_mode: true },
      { kind: 'str', name: 'model_code', display_name: 'Model', required: true },
      { kind: 'str', name: 'generation_url', display_name: 'Generation URL', required: true },
      { kind: 'secret_str', name: 'api_key', display_name: 'API Key' },
      { kind: 'str', name: 'negative_prompt', display_name: 'Negative prompt', default: '' },
      { kind: 'str', name: 'size', display_name: 'Size', default: '1024*1024' },
      { kind: 'bool', name: 'prompt_extend', display_name: 'Prompt extend', default: false },
      { kind: 'bool', name: 'watermark', display_name: 'Watermark', default: false },
    ],
    output: imageGenerationMessageOutput(),
    workflow: {
      blocks: imageGenerationDashscopeWorkflowBlocks(),
    },
  }
}

export function buildImageGenerationDslOpenAi(): Record<string, unknown> {
  return {
    dslVersion: 2,
    metadata: {
      name: 'AiApplicationImageGenerationOpenAI',
      display_name: 'AI Application Image Generation (OpenAI Images)',
      description: 'OpenAI Images API (POST /v1/images/generations); image URL from data[0].url.',
      icon: 'image',
      wrap_build_in_try: true,
    },
    inputs: [
      { kind: 'message_text', name: 'prompt', display_name: 'Prompt', default: '', tool_mode: true },
      { kind: 'str', name: 'model_code', display_name: 'Model', required: true },
      { kind: 'str', name: 'generation_url', display_name: 'Generation URL', required: true },
      { kind: 'secret_str', name: 'api_key', display_name: 'API Key' },
      { kind: 'str', name: 'size', display_name: 'Size', default: '1024x1024' },
    ],
    output: imageGenerationMessageOutput(),
    workflow: {
      blocks: imageGenerationOpenAiWorkflowBlocks(),
    },
  }
}

function imageGenerationOpenAiWorkflowBlocks(): Array<Record<string, unknown>> {
  const httpReadyThenBlocks: Array<Record<string, unknown>> = [
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: `(lambda _k: (_k if str(_k).strip() else (_ for _ in ()).throw(RuntimeError("API key is required for image generation"))))(${openaiApiKeyPlainExpr()})`,
      },
      output_as: 'api_key_plain',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '{**{"model": str(self.model_code or ""), "prompt": str(user_prompt), "n": 1, "response_format": "url", "size": (str(self.size or "1024x1024").strip().replace("*", "x") if str(self.size or "").strip() else "1024x1024")}}',
      },
      output_as: 'request_body',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '(("Bearer " + str(api_key_plain).strip()) if str(api_key_plain).strip() else (_ for _ in ()).throw(RuntimeError("API key is required for image generation")))',
      },
      output_as: 'authorization_header',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImageHttpRequestRawExpr(),
      },
      output_as: 'raw_submit',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImageParseHttpResponseExpr('raw_submit'),
      },
      output_as: 'submit_payload',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImagePayloadMustBeDictExpr('submit_payload'),
      },
      output_as: 'submit_payload',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImageItemFromPayloadExpr('submit_payload'),
      },
      output_as: 'image_item',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImageSrcFromItemExpr('image_item'),
      },
      output_as: 'image_src',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImageMarkdownFromSrcAndPayloadExpr(
          'image_src',
          'submit_payload',
          'raw_submit',
          'image_http_ready',
        ),
      },
      output_as: 'imageUrl',
    },
  ]

  return [
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '(str(self.prompt).strip() if isinstance(self.prompt, str) else str(self.prompt or ""))',
      },
      output_as: 'user_prompt',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '(str(user_prompt).strip() if str(user_prompt).strip() else (_ for _ in ()).throw(RuntimeError("Image generation prompt is required")))',
      },
      output_as: 'user_prompt',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: openaiImageHttpReadyFlagExpr(),
      },
      output_as: 'image_http_ready',
    },
    {
      type: 'if',
      condition: { kind: 'non_empty', field: 'image_http_ready' },
      // oxlint-disable-next-line unicorn/no-thenable -- DSL v2 约定：if 分支字段名为 then
      then: httpReadyThenBlocks,
      else: [
        {
          type: 'op',
          action: 'assign',
          params: { expr: '""' },
          output_as: 'imageUrl',
        },
      ],
    },
  ]
}

function imageGenerationDashscopeWorkflowBlocks(): Array<Record<string, unknown>> {
  return [
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: '(self.prompt.strip() if isinstance(self.prompt, str) else str(self.prompt or ""))',
      },
      output_as: 'user_prompt',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '{"model": str(self.model_code or ""), "input": {"messages": [{"role": "user", "content": [{"text": str(user_prompt)}]}]}, "parameters": {**({"negative_prompt": str(self.negative_prompt)} if getattr(self, "negative_prompt", None) else {}), **({"size": str(self.size)} if getattr(self, "size", None) else {}), **({"prompt_extend": bool(self.prompt_extend)} if getattr(self, "prompt_extend", None) is not None else {}), **({"watermark": bool(self.watermark)} if getattr(self, "watermark", None) is not None else {})}}',
      },
      output_as: 'request_body',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: '("Bearer " + str(self.api_key)) if self.api_key else ""',
      },
      output_as: 'authorization_header',
    },
    {
      type: 'op',
      action: 'http',
      params: {
        method: 'POST',
        url: '{{generation_url}}',
        timeout_ms: 300000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: '{{authorization_header}}',
        },
        body_type: 'json',
        body: '{{request_body}}',
      },
      output_as: 'raw_submit',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: safeJsonPayloadFromRawExpr('raw_submit'),
      },
      output_as: 'submit_payload',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: dashscopeImageUrlFromPayloadExpr('submit_payload'),
      },
      output_as: 'image_url',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '((submit_payload.get("output") or {}).get("task_id") if isinstance(submit_payload, dict) else None) or (submit_payload.get("task_id") if isinstance(submit_payload, dict) else None)',
      },
      output_as: 'task_id',
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr:
          '((submit_payload.get("output") or {}).get("task_status") if isinstance(submit_payload, dict) else None) or (submit_payload.get("task_status") if isinstance(submit_payload, dict) else None) or ""',
      },
      output_as: 'task_status',
    },
    {
      type: 'if',
      condition: { kind: 'non_empty', field: 'task_id' },
      // oxlint-disable-next-line unicorn/no-thenable -- DSL v2 约定：if 分支字段名为 then
      then: [
        {
          type: 'op',
          action: 'assign',
          params: {
            expr:
              '(str(self.generation_url or "").rstrip("/").split("/api/v1/services/")[0] if "/api/v1/services/" in str(self.generation_url or "") else str(self.generation_url or "").rstrip("/")) + "/api/v1/tasks/" + str(task_id)',
          },
          output_as: 'poll_url',
        },
        {
          type: 'op',
          action: 'http',
          params: {
            method: 'GET',
            url: '{{poll_url}}',
            timeout_ms: 300000,
            headers: {
              Authorization: '{{authorization_header}}',
            },
          },
          output_as: 'raw_poll',
        },
        {
          type: 'op',
          action: 'assign',
          params: {
            expr: safeJsonPayloadFromRawExpr('raw_poll'),
          },
          output_as: 'poll_payload',
        },
        {
          type: 'op',
          action: 'assign',
          params: {
            expr:
              '((poll_payload.get("output") or {}).get("task_status") if isinstance(poll_payload, dict) else None) or task_status',
          },
          output_as: 'task_status',
        },
        {
          type: 'op',
          action: 'assign',
          params: {
            expr: `${dashscopeImageUrlFromPayloadExpr('poll_payload')} or image_url`,
          },
          output_as: 'image_url',
        },
      ],
      else: [],
    },
    {
      type: 'op',
      action: 'assign',
      params: {
        expr: dashscopeImageMessageMarkdownExpr('image_url'),
      },
      output_as: 'imageUrl',
    },
  ]
}

function buildImageGenerationNode(
  node: FlowEditorNode,
  runtimeContext: FlowRuntimeContext,
  config: Record<string, unknown>,
  width: number,
  height: number,
  lfNodeId: string,
): CubeFlowNode {
  const prompt = imageGenerationPromptFromEditorConfig(config)
  const negativePrompt = normalizeOptionalString(config.negative_prompt) ?? ''
  const promptExtend = normalizeLanguageModelUseFlag(config.prompt_extend, false)
  const watermark = normalizeLanguageModelUseFlag(config.watermark, false)
  const rt = runtimeContext.imageGenerationRuntimeByNodeId?.get(node.id)
  const resolvedRt = rt && rt.providerType !== 'unsupported' ? rt : null
  const providerType = resolvedRt?.providerType ?? null
  const dsl = providerType === 'openai_image' ? buildImageGenerationDslOpenAi() : buildImageGenerationDslDashscope()
  const rawSize = normalizeOptionalString(config.size) ?? (providerType === 'openai_image' ? '1024x1024' : '1024*1024')
  const size =
    providerType === 'openai_image' && resolvedRt?.channelProfile
      ? resolveWireSize({ size: rawSize }, {
        nativeFamily: resolvedRt.nativeFamily ?? null,
        channelProfile: resolvedRt.channelProfile,
      })
      : rawSize
  if (!rt || rt.providerType === 'unsupported') {
    const reason = rt && rt.providerType === 'unsupported' ? rt.reason : 'image_generation_runtime_missing'
    const fallbackCode =
      normalizeOptionalString(config.modelId)?.trim() ||
      normalizeOptionalString((config as { model_code?: unknown }).model_code)?.trim() ||
      'unresolved'
    return {
      id: node.id,
      lfNodeId,
      cubeType: 'cube.lf.CustomComponent',
      x: Number(node.position?.x ?? 0),
      y: Number(node.position?.y ?? 0),
      width,
      height,
      config: {
        ...config,
        prompt,
        negative_prompt: negativePrompt,
        size,
        prompt_extend: promptExtend,
        watermark,
        generation_url: AI_APPLICATION_IMAGE_GEN_URL_PLACEHOLDER,
        api_key: AI_APPLICATION_IMAGE_GEN_API_KEY_PLACEHOLDER,
        model_code: fallbackCode,
        [CUSTOM_COMPONENT_DSL_KEY]: dsl,
        _unresolved_reason: reason,
      },
    }
  }

  const generationUrl = rt.generationUrl.trim() !== '' ? rt.generationUrl : AI_APPLICATION_IMAGE_GEN_URL_PLACEHOLDER
  const apiKey = rt.apiKey ?? AI_APPLICATION_IMAGE_GEN_API_KEY_PLACEHOLDER

  return {
    id: node.id,
    lfNodeId,
    cubeType: 'cube.lf.CustomComponent',
    x: Number(node.position?.x ?? 0),
    y: Number(node.position?.y ?? 0),
    width,
    height,
    config: {
      ...config,
      prompt,
      negative_prompt: negativePrompt,
      size,
      prompt_extend: promptExtend,
      watermark,
      generation_url: generationUrl,
      api_key: apiKey,
      model_code: rt.modelCode,
      /** 仅内联 DSL 参与 cube-ai 代码生成；避免绑定旧模板导致 Python 不随 DSL 更新 */
      [CUSTOM_COMPONENT_DSL_KEY]: dsl,
    },
  }
}

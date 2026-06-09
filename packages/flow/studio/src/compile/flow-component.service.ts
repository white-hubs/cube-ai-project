import { Injectable } from '@dangao/bun-server'
import { currentTenantId } from '@cube-ai/server-shared'
import type { FlowStudioComponentRow } from '../db/rows'
import { FlowStudioComponentRepository } from '../db/component.repository'

export interface FlowComponentCatalogItem {
  id: string
  componentKey: string
  componentName: string
  componentGroup: string | null
  componentType: string
  componentVersion: string
  mappingType: string
  mappingTarget: string | null
  iconUrl: string | null
  enabled: boolean
  isBuiltin: boolean
  presentationSchema: Record<string, unknown> | null
  protocolSchema: Record<string, unknown> | null
  executionPolicy: Record<string, unknown> | null
}

/** 画布物料已下架，列表不再返回（租户库中历史行也会被过滤） */
const HIDDEN_CATALOG_COMPONENT_KEYS = new Set(['webhook'])

const BUILTIN_COMPONENTS: FlowComponentCatalogItem[] = [
  {
    id: 'builtin:chat-input',
    componentKey: 'chat-input',
    componentName: '聊天输入',
    componentGroup: '基础节点',
    componentType: 'trigger',
    componentVersion: '1.0.0',
    mappingType: 'direct-node',
    mappingTarget: 'cube.lf.ChatInput',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: { fields: [{ key: 'placeholder', label: '占位文本', type: 'string' }] },
    protocolSchema: { inputs: [], outputs: ['message'] },
    executionPolicy: { runnable: true },
  },
  {
    id: 'builtin:chat-output',
    componentKey: 'chat-output',
    componentName: '聊天输出',
    componentGroup: '基础节点',
    componentType: 'output',
    componentVersion: '1.0.0',
    mappingType: 'direct-node',
    mappingTarget: 'cube.lf.ChatOutput',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: { fields: [{ key: 'placeholder', label: '占位文本', type: 'string' }] },
    protocolSchema: { inputs: ['input_value'], outputs: ['message'] },
    executionPolicy: { runnable: true },
  },
  {
    id: 'builtin:mcp-synthetic',
    componentKey: 'mcp',
    componentName: 'MCP Tools（合成）',
    componentGroup: '内部',
    componentType: 'processor',
    componentVersion: '1.0.0',
    mappingType: 'preset-node',
    mappingTarget: 'cube.lf.MCPTools',
    iconUrl: null,
    enabled: false,
    isBuiltin: true,
    presentationSchema: null,
    /** 编译用端口名：与 cube-ai 边 `o-component_as_tool` / Agent `i-tools` 一致 */
    protocolSchema: { inputs: [], outputs: ['component_as_tool'] },
    executionPolicy: { runnable: false },
  },
  {
    id: 'builtin:agent',
    componentKey: 'agent',
    componentName: '智能体',
    componentGroup: '基础节点',
    componentType: 'processor',
    componentVersion: '1.0.0',
    mappingType: 'preset-node',
    mappingTarget: 'cube.lf.Agent',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      fields: [
        { key: 'modelId', label: '模型', type: 'model-ref', required: true },
        {
          key: 'systemPrompt',
          label: '智能体指令',
          type: 'textarea',
          required: false,
          description: '定义角色、工具策略及回复边界；同步至运行时指令。',
        },
      ],
    },
    /** 画布仅 `input_value`；`tools`/`agent_llm` 由 compile 注入 MCP 与伴侣 LLM */
    protocolSchema: { inputs: ['input_value'], outputs: ['response'] },
    executionPolicy: { runnable: true, resources: ['llm-model'] },
  },
  {
    id: 'builtin:language-model',
    componentKey: 'language-model',
    componentName: '语言模型',
    componentGroup: '基础节点',
    componentType: 'processor',
    componentVersion: '1.0.0',
    mappingType: 'preset-node',
    mappingTarget: 'cube.lf.CustomComponent',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      fields: [
        { key: 'modelId', label: '模型', type: 'model-ref', required: true },
        { key: 'input', label: '用户输入', type: 'string' },
        { key: 'systemMessage', label: '系统 message', type: 'string' },
      ],
    },
    /** 画布协议仅 `message`（见前端 flow-ports）；compile 时 mergeProtocolPortsForCompile 会补全 `model` 供伴侣 LLM→SmartRouter 的 `o-model` 边解析 */
    protocolSchema: { inputs: ['input'], outputs: ['message'] },
    executionPolicy: { runnable: true, resources: ['llm-model'] },
  },
  {
    id: 'builtin:image-generation',
    componentKey: 'image-generation',
    componentName: '图像生成',
    componentGroup: '基础节点',
    componentType: 'processor',
    componentVersion: '1.0.0',
    mappingType: 'preset-node',
    mappingTarget: 'cube.lf.CustomComponent',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      fields: [
        { key: 'modelId', label: '模型', type: 'model-ref', required: true },
        { key: 'prompt', label: '提示词', type: 'string' },
        { key: 'negative_prompt', label: '反向提示词', type: 'string' },
        { key: 'size', label: '分辨率', type: 'string' },
        { key: 'prompt_extend', label: '提示词改写', type: 'boolean' },
        { key: 'watermark', label: '水印', type: 'boolean' },
      ],
    },
    protocolSchema: { inputs: ['prompt'], outputs: ['imageUrl'] },
    executionPolicy: { runnable: true, resources: ['llm-model'] },
  },
  {
    id: 'builtin:prompt-template',
    componentKey: 'prompt-template',
    componentName: '提示词模板',
    componentGroup: '基础节点',
    componentType: 'processor',
    componentVersion: '1.0.0',
    mappingType: 'direct-node',
    mappingTarget: 'cube.lf.Prompt Template',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      fields: [
        {
          key: 'template',
          label: '模板内容',
          type: 'textarea',
          required: true,
          description: '动态变量通过 ${变量名} 占位；画布上每个占位对应一个输入连接点，连线传入该变量文本。模板正文本身不可连线。',
        },
      ],
    },
    protocolSchema: { inputs: [], outputs: ['prompt'] },
    executionPolicy: { runnable: true },
  },
  {
    id: 'builtin:smart-router',
    componentKey: 'smart-router',
    componentName: '智能路由',
    componentGroup: '基础节点',
    componentType: 'router',
    componentVersion: '1.0.0',
    mappingType: 'subgraph-template',
    mappingTarget: 'cube.lf.SmartRouter',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      fields: [
        { key: 'modelId', label: '路由模型', type: 'model-ref', required: true },
        {
          key: 'custom_prompt',
          label: '附加说明',
          type: 'textarea',
          required: false,
          description:
            '与 cube-ai SmartRouter「Additional Instructions」一致，写入路由模型的分类提示补充段；可使用 {input_text}、{routes} 占位。',
        },
      ],
    },
    /** cube-ai 智能路由：`input_text` 主输入，`model` 由 compile 注入的伴侣语言模型连接 */
    protocolSchema: { inputs: ['input_text', 'model'], outputs: ['route'] },
    executionPolicy: { runnable: true, resources: ['llm-model'] },
  },
  {
    id: 'builtin:knowledge-retrieval',
    componentKey: 'knowledge-retrieval',
    componentName: '知识库检索',
    componentGroup: '基础节点',
    componentType: 'processor',
    componentVersion: '1.0.0',
    mappingType: 'preset-node',
    mappingTarget: 'KnowledgeRetrieval',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    /** 画布侧使用专用属性面板编辑 knowledgeSources；此处不暴露通用表单字段 */
    presentationSchema: {
      fields: [],
    },
    protocolSchema: { inputs: ['query'], outputs: ['SEARCH_RESULTS'] },
    executionPolicy: { runnable: true, resources: ['knowledge-document'] },
  },
  {
    id: 'builtin:if-else',
    componentKey: 'if-else',
    componentName: '条件分支',
    componentGroup: '流程控制',
    componentType: 'branch',
    componentVersion: '1.0.0',
    mappingType: 'direct-node',
    mappingTarget: 'cube.lf.ConditionalRouter',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    /** 侧栏与画布入桩由前端条件分支专局面板维护，与 cube-ai 一致 */
    presentationSchema: {
      description:
        '画布入边由侧栏三项开关控制；节点内为预览；IF / ELSE 在入参下方右侧；默认路由等仅存配置。',
      fields: [],
    },
    protocolSchema: { inputs: [], outputs: ['if', 'else'] },
    executionPolicy: { runnable: true },
  },
  {
    id: 'builtin:loop',
    componentKey: 'loop',
    componentName: '循环',
    componentGroup: '流程控制',
    componentType: 'control',
    componentVersion: '1.0.0',
    mappingType: 'direct-node',
    mappingTarget: 'cube.lf.LoopComponent',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      fields: [
        {
          key: 'item_key',
          label: '列表项取值键',
          type: 'string',
          required: false,
          description:
            '遍历列表（Data/DataFrame）时逐项取值的字段名；缺省为 text，与 Langflow Loop 文档行为一致。',
        },
      ],
    },
    /** items：列表输入；looping：子链末端回连以处理下一项；item/done：当前项与全部完成 */
    protocolSchema: { inputs: ['items', 'looping'], outputs: ['item', 'done'] },
    executionPolicy: { runnable: true },
  },
  {
    id: 'builtin:notify',
    componentKey: 'notify',
    componentName: '通知发送',
    componentGroup: '流程控制',
    componentType: 'action',
    componentVersion: '1.0.0',
    mappingType: 'direct-node',
    mappingTarget: 'cube.lf.Notify',
    iconUrl: null,
    enabled: true,
    isBuiltin: true,
    presentationSchema: {
      description: '通知写入上下文：配置上下文键与是否追加；画布固定展示上下文键预览、输入数据入边、追加状态与数据出口。',
      fields: [
        { key: 'context_key', label: '上下文键', type: 'string', required: true },
        { key: 'append', label: '追加', type: 'boolean', required: false },
      ],
    },
    protocolSchema: { inputs: ['message'], outputs: ['result'] },
    executionPolicy: { runnable: true },
  },
]

/** 内置物料 protocolSchema，供编译 cube 图/skill 与画布兜底对齐 */
export function builtinProtocolPortsForComponentKey(componentKey: string): { inputs: string[]; outputs: string[] } {
  if (componentKey === 'multimodal-message-merge') {
    return { inputs: ['text', 'original_message'], outputs: ['message'] }
  }
  const item = BUILTIN_COMPONENTS.find((c) => c.componentKey === componentKey)
  const schema = item?.protocolSchema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return { inputs: [], outputs: [] }
  }
  const inputsRaw = (schema as Record<string, unknown>).inputs
  const outputsRaw = (schema as Record<string, unknown>).outputs
  const inputs = Array.isArray(inputsRaw)
    ? inputsRaw.map((item) => String(item).trim()).filter((item) => item !== '')
    : []
  const outputs = Array.isArray(outputsRaw)
    ? outputsRaw.map((item) => String(item).trim()).filter((item) => item !== '')
    : []
  return { inputs, outputs }
}

/**
 * cube-ai 语义边上使用的智能路由出口名：`category_{n}_result`（与画布 `flow-ports`、节点 config 一致）。
 * routes 缺失或空数组时仍按 **至少 1 条** 生成，避免回退到占位名 `route` 导致编译校验失败、多出线汇聚到同一 cube.sp 端口。
 */
export function smartRouterCompileOutputsFromRoutes(editorNodeConfig: Record<string, unknown> | undefined): string[] {
  const cfg = editorNodeConfig ?? {}
  const routes = cfg.routes
  const count = Array.isArray(routes) && routes.length > 0 ? routes.length : 1
  return Array.from({ length: count }, (_, index) => `category_${index + 1}_result`)
}

/** 从编辑器边 `sourcePort` 或已序列化的 `cube.sp/o/...` 串中取出输出字段名 */
export function parseEditorEdgeOutputBasename(rawSourcePort: string): string {
  const t = rawSourcePort.trim()
  if (t === '' || t === 'output') {
    return ''
  }
  if (t.startsWith('cube.sp/o/')) {
    const m = /^cube\.sp\/o\/[^/]+\/(.+)$/.exec(t)
    return m?.[1]?.trim() ?? ''
  }
  return t.replace(/^o(:|-)/, '').trim()
}

/**
 * 从「源为该智能路由」的边上解析最大的 `category_N_result` 下标，用于 routes 条数与持久化不一致时的兜底。
 */
export function maxSmartRouterCategoryIndexFromEdges(
  routerGraphNodeId: string,
  edges: Array<{ source: string; sourcePort?: string | null }>,
): number {
  let max = 0
  for (const e of edges) {
    if (e.source !== routerGraphNodeId) {
      continue
    }
    const base = parseEditorEdgeOutputBasename(e.sourcePort ?? '')
    const m = /^category_(\d+)_result$/.exec(base)
    if (m) {
      const n = Number.parseInt(m[1] ?? '0', 10)
      if (Number.isFinite(n)) {
        max = Math.max(max, n)
      }
    }
  }
  return max
}

/**
 * 编译推送到 cube-ai 图时，智能路由可用输出名列表：`routes` 条数与「实际边上的桩」取较大值，避免合法边落在校验集合之外而被当成第一个出口。
 */
export function smartRouterCompileOutputNamesForGraph(
  routerConfig: Record<string, unknown> | undefined,
  routerGraphNodeId: string,
  edges: Array<{ source: string; sourcePort?: string | null }>,
): string[] {
  const fromRoutes = smartRouterCompileOutputsFromRoutes(routerConfig)
  const routeBasedCount = fromRoutes.length
  const maxIdx = maxSmartRouterCategoryIndexFromEdges(routerGraphNodeId, edges)
  const count = Math.max(routeBasedCount, maxIdx, 1)
  return Array.from({ length: count }, (_, i) => `category_${i + 1}_result`)
}

/** 与前端 `ifElseDynamicInputPortNames` 一致（侧栏三开关；无 key 时三者默认开） */
function ifElseCompileInputPortsFromEditorConfig(cfg: Record<string, unknown> | undefined): string[] {
  const c = cfg ?? {}
  const hasToggleKeys =
    c.enable_text_input !== undefined || c.enable_operator !== undefined || c.enable_match_text !== undefined
  const open = hasToggleKeys
    ? {
        enable_text_input: Boolean(c.enable_text_input),
        enable_operator: Boolean(c.enable_operator),
        enable_match_text: Boolean(c.enable_match_text),
      }
    : {
        enable_text_input: true,
        enable_operator: true,
        enable_match_text: true,
      }
  const ports: string[] = []
  if (open.enable_text_input) {
    ports.push('input_text')
  }
  if (open.enable_operator) {
    ports.push('operator')
  }
  if (open.enable_match_text) {
    ports.push('match_text')
  }
  return ports
}

/**
 * 与前端 mergeProtocolListsFromCatalog 一致：DB/catalog 未配置 ports 时回落到内置，
 * 否则编译出的 cube.sp 语义端口名会与 cube-ai 物料约定不一致。
 *
 * `language-model`：compile 须识别 `model`，否则智能路由伴侣注入边 `o-model` 会被误判成 `message`。
 *
 * `smart-router`：内置 protocol 仅为占位；须结合节点 config（及图上出线）展开为 `category_*_result`。
 */
export function mergeProtocolPortsForCompile(
  component: FlowComponentCatalogItem | undefined,
  componentKey: string,
  editorNodeConfig?: Record<string, unknown>,
): { inputs: string[]; outputs: string[] } {
  const schema = component?.protocolSchema
  const fromCatalog = (): { inputs: string[]; outputs: string[] } => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { inputs: [], outputs: [] }
    }
    const inputsRaw = (schema as Record<string, unknown>).inputs
    const outputsRaw = (schema as Record<string, unknown>).outputs
    const inputs = Array.isArray(inputsRaw)
      ? inputsRaw.map((item) => String(item).trim()).filter((item) => item !== '')
      : []
    const outputs = Array.isArray(outputsRaw)
      ? outputsRaw.map((item) => String(item).trim()).filter((item) => item !== '')
      : []
    return { inputs, outputs }
  }
  const parsed = fromCatalog()
  const fb = builtinProtocolPortsForComponentKey(componentKey)
  const merged = {
    inputs: parsed.inputs.length > 0 ? parsed.inputs : fb.inputs,
    outputs: parsed.outputs.length > 0 ? parsed.outputs : fb.outputs,
  }
  if (componentKey === 'language-model') {
    return {
      inputs: merged.inputs,
      outputs: ['message', 'model'],
    }
  }
  if (componentKey === 'multimodal-message-merge') {
    return {
      inputs: ['text', 'original_message'],
      outputs: ['message'],
    }
  }
  if (componentKey === 'agent') {
    return {
      inputs: ['input_value', 'tools', 'agent_llm'],
      outputs: merged.outputs.length > 0 ? merged.outputs : ['response'],
    }
  }
  if (componentKey === 'mcp') {
    return {
      inputs: [],
      outputs: ['component_as_tool'],
    }
  }
  if (componentKey === 'smart-router') {
    const dynamic = smartRouterCompileOutputsFromRoutes(editorNodeConfig)
    if (dynamic.length > 0) {
      return {
        inputs: merged.inputs,
        outputs: dynamic,
      }
    }
  }
  if (componentKey === 'if-else') {
    return {
      inputs: ifElseCompileInputPortsFromEditorConfig(editorNodeConfig),
      outputs: ['if', 'else'],
    }
  }
  return merged
}

function safeParseObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

@Injectable()
export class FlowComponentService {
  public constructor(private readonly flowComponentRepository: FlowStudioComponentRepository) {}

  private currentTenant(): string {
    return (currentTenantId() ?? '').trim()
  }

  private fromEntity(entity: FlowStudioComponentRow): FlowComponentCatalogItem {
    return {
      id: String(entity.id),
      componentKey: entity.component_key,
      componentName: entity.component_name,
      componentGroup: entity.component_group,
      componentType: entity.component_type,
      componentVersion: entity.component_version,
      mappingType: entity.mapping_type,
      mappingTarget: entity.mapping_target,
      iconUrl: entity.icon_url,
      enabled: entity.enabled,
      isBuiltin: entity.is_builtin,
      presentationSchema: safeParseObject(entity.presentation_schema_json),
      protocolSchema: safeParseObject(entity.protocol_schema_json),
      executionPolicy: safeParseObject(entity.execution_policy_json),
    }
  }

  public async listCatalog(): Promise<FlowComponentCatalogItem[]> {
    const tenant = this.currentTenant()
    if (!tenant) {
      return BUILTIN_COMPONENTS.filter((item) => !HIDDEN_CATALOG_COMPONENT_KEYS.has(item.componentKey))
    }
    const customRows = await this.flowComponentRepository.listEnabledByTenant(tenant)
    const customMap = new Map(customRows.map((row) => [row.component_key, this.fromEntity(row)]))
    const merged = BUILTIN_COMPONENTS.map((item) => customMap.get(item.componentKey) ?? item)
    for (const row of customRows) {
      if (!merged.some((item) => item.componentKey === row.component_key)) {
        merged.push(this.fromEntity(row))
      }
    }
    return merged.filter((item) => !HIDDEN_CATALOG_COMPONENT_KEYS.has(item.componentKey))
  }

  public async getCatalogMap(componentKeys?: string[]): Promise<Map<string, FlowComponentCatalogItem>> {
    const list = await this.listCatalog()
    const filtered = componentKeys?.length ? list.filter((item) => componentKeys.includes(item.componentKey)) : list
    return new Map(filtered.map((item) => [item.componentKey, item]))
  }
}

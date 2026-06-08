/**
 * 组件 Schema 与端口推导（Cube 设计器）。
 * 由 server 序列化、web 消费；避免重复实现连接规则。
 */

import { findPromptInputSlotName, resolvePromptTemplateVariableNames } from './prompt-template'

export const CUBE_COMPONENT_SCHEMA_VERSION = 1 as const

/** Cube 自定义组件 DSL（JSON）。仅在服务端「同步至执行后端」的闭环内编译为可运行组件源码。 */
export const CUBE_CUSTOM_COMPONENT_DSL_KEY = 'cube_dsl' as const

/** 节点来自「自定义组件模板库」时写入；画布与侧栏不提供 DSL 编辑，须在模板管理中改。 */
export const CUBE_CUSTOM_TEMPLATE_ID_KEY = 'cube_custom_template_id' as const

/** 自执行后端导入的不透明源码快照；无 DSL 时用于回写。不进设计器通用 schema `inputs`。键名历史兼容保留。 */
export const CUBE_LF_CODE_OPAQUE_KEY = 'cube_lf_code_opaque' as const

/** `HandleInput`：仅连线、不在组件内填值（与 `input_types` 具体是 Tool 还是 Data 无关）。 */
export function isConnectionOnlyInputType(inputType: string): boolean {
  return inputType === 'HandleInput'
}

/** Langflow `TableInput.table_schema` 列定义（与设计器表格编辑器对齐） */
export type CubeTableColumnSpec = {
  name: string
  displayName: string
  description?: string
  type?: string
  /** api-all `edit_mode`：inline | popover 等，当前统一按单元格内联编辑处理 */
  editMode?: string
  default?: unknown
}

/**
 * 静态 api-all 里 MCPTools 常无 `tools_metadata` 槽，或仅为 `ToolsInput` 且无 `table_schema`；
 * Actions / 工具表弹层需列定义时用此回退（与 Langflow Tools 表 Name·Description·Slug 一致）。
 */
export const MCPTOOLS_TOOLS_METADATA_FALLBACK_TABLE_SCHEMA: CubeTableColumnSpec[] = [
  {
    name: 'name',
    displayName: 'Tool ID',
    description: 'Function name / key (often snake_case).',
    type: 'str',
    default: '',
  },
  {
    name: 'display_name',
    displayName: 'Name',
    description: 'Human-readable title (shown like Langflow Name column).',
    type: 'str',
    default: '',
  },
  {
    name: 'description',
    displayName: 'Description',
    description: 'Docstring-style description for the agent.',
    type: 'str',
    default: '',
  },
  {
    name: 'slug',
    displayName: 'Slug',
    description: 'Stable slug, often UPPER_SNAKE_CASE.',
    type: 'str',
    default: '',
  },
]

/** 单输入字段（来自 api-all template，已剔除 code） */
/** Langflow Agent：`+ Connect other models` 选中后写入 `model`（LF 1.8.2+）或旧版 `agent_llm` 的值 */
export const AGENT_LLM_CONNECT_OTHER = 'connect_other_models' as const

/** Agent 上表示「语言模型」的输入槽：旧版 `agent_llm`，LF 1.8.2+ 统一为 `model`（ModelInput）。 */
export function isAgentLlmInputFieldName(name: string): boolean {
  return name === 'agent_llm' || name === 'model'
}

/**
 * 内置模型提供方字段；`connect_other_models` 模式下从画布与 LF 模板中移除（与 LF `ALL_PROVIDER_FIELDS` / 统一 ModelInput 对齐）。
 */
export const AGENT_PROVIDER_FIELD_NAMES = [
  'api_key',
  'base_url',
  'base_url_ibm_watsonx',
  'project_id',
  'max_output_tokens',
  'max_tokens',
  'model_kwargs',
  'model_name',
  'openai_api_base',
  'temperature',
  'seed',
  'max_retries',
  'timeout',
] as const

export const AGENT_PROVIDER_FIELD_NAME_SET = new Set<string>(AGENT_PROVIDER_FIELD_NAMES)

export type CubeSchemaInputField = {
  name: string
  displayName: string
  inputTypes: string[]
  advanced: boolean
  show: boolean
  password: boolean
  /** api-all `_input_type`（`HandleInput` = 纯连接桩，见 `isConnectionOnlyInputType`） */
  inputType: string
  /** api-all type */
  fieldType: string
  info: string
  required: boolean
  /** template 项上的 tool_mode（与组件级 tool_mode 配合，见 deriveConnectablePorts 注释） */
  fieldToolMode: boolean
  value: unknown
  options?: unknown
  /** DropdownInput 等：`placeholder`（api-all） */
  placeholder?: string
  /** DropdownInput：`external_options.fields.data.node`（如「连接其他模型」） */
  externalConnectAction?: { name: string; displayName: string }
  rangeSpec?: Record<string, unknown>
  list?: boolean
  /** `TableInput`：列定义；无则回退为 JSON 编辑 */
  tableSchema?: CubeTableColumnSpec[]
  /** `TableInput.trigger_text`，默认「打开表格」由前端 i18n */
  triggerText?: string
}

export type CubeSchemaOutputField = {
  name: string
  displayName: string
  types: string[]
  toolMode: boolean
  allowsLoop: boolean
  /** api-all outputs[].method；Tool 模式下列 Actions 时用作回退展示名 */
  method?: string
}

export type CubeComponentSchemaV1 = {
  version: typeof CUBE_COMPONENT_SCHEMA_VERSION
  cubeType: string
  lfComponentKey: string
  displayName: string
  description: string
  /** api-all 组件根上的 tool_mode 默认值 */
  componentToolModeDefault: boolean
  /** 与组件 `field_order` 一致：输入字段 `name` 的展示顺序；缺省则保持拾取顺序 */
  fieldOrder?: string[]
  outputs: CubeSchemaOutputField[]
  inputs: CubeSchemaInputField[]
}

/** 同名输入只保留首次出现（与 catalog / 运行时一致） */
export function dedupeSchemaInputsByName<T extends { name: string }>(inputs: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const f of inputs) {
    if (seen.has(f.name)) continue
    seen.add(f.name)
    out.push(f)
  }
  return out
}

/**
 * `field_order` 中 name 偶有重复（如 Agent 中 api_key 出现两次）；以首次出现为准。
 */
export function dedupeFieldOrderNames(fieldOrder: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of fieldOrder) {
    if (seen.has(n)) continue
    seen.add(n)
    out.push(n)
  }
  return out
}

/**
 * 与模板字段对齐的可排序名：每个 slot 计入其对象 key，以及 slot.name（若存在）。
 * 跳过 `code`、`_type` 及非对象 slot（与 pickInputs 一致）。
 */
export function validFieldOrderNamesFromTemplate(template: Record<string, unknown>): Set<string> {
  const s = new Set<string>()
  for (const [key, slot] of Object.entries(template)) {
    if (key === '_type' || key === 'code') continue
    if (!slot || typeof slot !== 'object') continue
    s.add(key)
    const nm = (slot as Record<string, unknown>)['name']
    if (typeof nm === 'string' && nm.length > 0) s.add(nm)
  }
  return s
}

/**
 * 去掉 template 中不存在的名、再按首次出现去重。
 * 无 template 时仅去重（与旧图或异常节点兼容）。
 */
export function sanitizeFieldOrderForTemplate(
  fieldOrder: readonly string[],
  template: Record<string, unknown> | null | undefined,
): string[] {
  if (!template || typeof template !== 'object') return dedupeFieldOrderNames(fieldOrder)
  const ok = validFieldOrderNamesFromTemplate(template)
  const filtered = fieldOrder.filter((n) => ok.has(n))
  return dedupeFieldOrderNames(filtered)
}

/**
 * 按 `field_order` 排列字段；未出现在表中的字段按原有顺序接在后面。
 * `field_order` 内重复 name 只参与排序一次（与实际单列展示一致）。
 */
export function orderInputsByFieldOrder<T extends { name: string }>(
  inputs: readonly T[],
  fieldOrder: string[] | undefined | null,
): T[] {
  const list = [...inputs]
  if (!fieldOrder || fieldOrder.length === 0) return list
  const byName = new Map(list.map((f) => [f.name, f] as const))
  const seen = new Set<string>()
  const ordered: T[] = []
  for (const name of fieldOrder) {
    if (seen.has(name)) continue
    const f = byName.get(name)
    if (f) {
      ordered.push(f)
      seen.add(name)
    }
  }
  for (const f of list) {
    if (!seen.has(f.name)) ordered.push(f)
  }
  return ordered
}

export type ConnectablePort = {
  kind: 'in' | 'out'
  /** X6 port id，如 i:input_value / o:text_output */
  x6PortId: string
  /** 语义端口中的 outputName 或 fieldName */
  logicalName: string
  displayLabel: string
  types: string[]
  /** 仅输出：schema `output.tool_mode`；Tool 节点模式下用于桩色与类型推导 */
  schemaOutputToolMode?: boolean
}

/**
 * 节点 Tool 模式下，`tool_mode` 输出在编排侧视为可连 Tool 桩；api-all 常仍为 Data，此处补 `Tool` 以利校验与连线色。
 */
export function effectiveSchemaOutputTypes(
  types: readonly string[],
  outputToolMode: boolean,
  nodeToolMode?: boolean,
): string[] {
  if (nodeToolMode === true && outputToolMode) {
    const t = [...types]
    const low = t.map((x) => String(x).toLowerCase())
    if (!low.some((x) => x.includes('tool'))) t.push('Tool')
    return t
  }
  return [...types]
}

export function x6InputPortId(fieldName: string): string {
  return `i:${fieldName}`
}

export function x6OutputPortId(outputName: string): string {
  return `o:${outputName}`
}

export function parseX6PortId(id: string): { kind: 'in' | 'out'; logical: string } | null {
  if (id.startsWith('i:')) return { kind: 'in', logical: id.slice(2) }
  if (id.startsWith('o:')) return { kind: 'out', logical: id.slice(2) }
  return null
}

/** 合并 config 覆盖到 schema 输入默认值，用于布尔开关等 */
export function mergeConfigWithInputDefaults(
  inputs: CubeSchemaInputField[],
  config: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const f of inputs) {
    merged[f.name] = config[f.name] !== undefined ? config[f.name] : f.value
  }
  Object.assign(merged, config)
  return merged
}

/**
 * 参考组件画布显隐：节点 tool 模式下 `isHidden` = `!show || (template.tool_mode && isToolMode)`；
 * 画布可见 = 非 hidden 且非 `advanced`。
 */
function templateInputHiddenForToolNode(
  f: Pick<CubeSchemaInputField, 'show' | 'fieldToolMode'>,
  nodeToolMode: boolean,
  fieldEnabled?: Record<string, boolean> | null,
  name?: string,
): boolean {
  const override = name !== undefined ? fieldEnabled?.[name] : undefined
  const effectiveShow = override !== undefined ? override : f.show
  if (!effectiveShow) return true
  return f.fieldToolMode === true && nodeToolMode === true
}

export function isCanvasVisibleComponentInput(
  f: Pick<CubeSchemaInputField, 'show' | 'advanced' | 'fieldToolMode' | 'name'>,
  nodeToolMode: boolean,
  fieldEnabled?: Record<string, boolean> | null,
  fieldAdvanced?: Record<string, boolean> | null,
): boolean {
  if (templateInputHiddenForToolNode(f, nodeToolMode, fieldEnabled, f.name)) return false
  const advOverride = f.name !== undefined ? fieldAdvanced?.[f.name] : undefined
  const effectiveAdvanced = advOverride !== undefined ? advOverride : f.advanced
  if (effectiveAdvanced) return false
  return true
}

/** 节点 tool 模式下，template 上 `tool_mode` 的字段排在非 tool_mode 字段之后 */
export function compareToolModeCanvasFieldOrder(
  a: Pick<CubeSchemaInputField, 'fieldToolMode'>,
  b: Pick<CubeSchemaInputField, 'fieldToolMode'>,
): number {
  const at = a.fieldToolMode === true ? 1 : 0
  const bt = b.fieldToolMode === true ? 1 : 0
  if (at !== bt) return at - bt
  return 0
}

/**
 * 画布卡片与连线用的输入列表（已按 field_order 排序后再按 tool 模式筛选与二次排序）。
 */
export function visibleCanvasComponentInputs(
  inputsOrdered: readonly CubeSchemaInputField[],
  nodeToolMode: boolean,
  fieldEnabled?: Record<string, boolean> | null,
  fieldAdvanced?: Record<string, boolean> | null,
): CubeSchemaInputField[] {
  const vis = inputsOrdered.filter((f) =>
    isCanvasVisibleComponentInput(f, nodeToolMode, fieldEnabled, fieldAdvanced),
  )
  if (!nodeToolMode) return vis
  return [...vis].sort(compareToolModeCanvasFieldOrder)
}

/**
 * 节点 tool 模式下优先 `output.tool_mode === true` 的端口；否则回落全量。
 * 非 tool 模式优先 `tool_mode !== true` 的端口；否则回落全量。
 */
export function filterOutputsForNodeToolMode<T extends { toolMode: boolean }>(
  outputs: readonly T[],
  nodeToolMode?: boolean,
): T[] {
  if (outputs.length === 0) return []
  if (nodeToolMode === true) {
    const tool = outputs.filter((o) => o.toolMode === true)
    return tool.length > 0 ? [...tool] : [...outputs]
  }
  const normal = outputs.filter((o) => o.toolMode !== true)
  return normal.length > 0 ? normal : [...outputs]
}

/** 与 tools_metadata 行里 `name`（tool id）对齐的 UPPER_SNAKE，用于 Slug 列与机读判断 */
function mcpToolSlugFromToolId(name: string): string {
  return name
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .toUpperCase()
}

/** 与 Langflow / graph-translator `humanizeSnakeCaseToolName` 一致：作 Actions「Name」展示 */
function humanizeSnakeCaseToolId(name: string): string {
  const n = name.trim()
  if (!n) return n
  return n.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * `display_name` / schema `title` 若为全大写+下划线或与 Slug 一致，则不宜作为 Actions 文案
 *（MCP JSON Schema 常把 title 设成 BUILD_OUTPUT 之类）。
 */
function toolsMetadataActionLabelIsMachineSlug(label: string, toolId: string): boolean {
  const l = label.trim()
  const id = toolId.trim()
  if (!l || !id) return false
  if (l === mcpToolSlugFromToolId(id)) return true
  if (/^[A-Z][A-Z0-9_]*$/.test(l) && l.includes('_')) return true
  return false
}

/**
 * LF `tools_metadata`（ToolsInput 的 value）→ 画布 Actions 标签文案；`display_name` 优先于 `name`，
 * 但会跳过机读 slug（与 LF Tools 表 Name 列可读标题对齐）。
 */
export function toolMetadataActionLabels(toolsMetadata: unknown): string[] {
  if (!Array.isArray(toolsMetadata)) return []
  const labels: string[] = []
  for (const item of toolsMetadata) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const dnRaw = o['display_name']
    const nmRaw = o['name']
    const toolId = typeof nmRaw === 'string' && nmRaw.trim() ? nmRaw.trim() : ''
    let label =
      typeof dnRaw === 'string' && dnRaw.trim()
        ? dnRaw.trim()
        : toolId
          ? toolId
          : ''
    if (!label) continue
    if (toolId) {
      if (toolsMetadataActionLabelIsMachineSlug(label, toolId)) {
        label = humanizeSnakeCaseToolId(toolId)
      } else if (label === toolId && toolId.includes('_')) {
        label = humanizeSnakeCaseToolId(toolId)
      }
    }
    labels.push(label)
  }
  return labels
}

/**
 * 节点 Tool 模式下的 Actions 标签：`tools_metadata` 优先，否则回退到当前主输出的 `method`（api-all）。
 */
export function cubeToolModeActionLabels(
  toolsMetadata: unknown,
  primaryOutput: Pick<CubeSchemaOutputField, 'toolMode' | 'method'> | undefined,
): string[] {
  const fromMeta = toolMetadataActionLabels(toolsMetadata)
  if (fromMeta.length > 0) return fromMeta
  if (
    primaryOutput?.toolMode === true &&
    typeof primaryOutput.method === 'string' &&
    primaryOutput.method.trim()
  ) {
    return [primaryOutput.method.trim()]
  }
  return []
}

/**
 * 尚无 `tools_metadata` 时生成一条 LF 常见形状的默认项（当前选中 tool 输出需带 `method`）。
 */
export function buildDefaultToolsMetadataForToolMode(
  schema: CubeComponentSchemaV1,
  selectedOutputIdx: number,
): Record<string, unknown>[] {
  const visOut = filterOutputsForNodeToolMode(schema.outputs, true)
  if (visOut.length === 0) return []
  const maxIdx = Math.max(0, visOut.length - 1)
  const outIdx = Math.min(Math.max(0, selectedOutputIdx), maxIdx)
  const o = visOut[outIdx]
  if (!o || o.toolMode !== true || typeof o.method !== 'string' || !o.method.trim()) return []
  const method = o.method.trim()
  const desc = `${schema.displayName}. ${method}()`
  return [
    {
      name: method,
      display_name: method,
      display_description: desc,
      description: desc,
      tags: [method],
      status: true,
      args: {} as Record<string, unknown>,
    },
  ]
}

/**
 * 节点 Tool 模式：`tools_metadata` 为空时写入默认数组，便于存图/与外部编排对齐。
 */
export function ensureCubeConfigToolsMetadataForToolMode(
  cfg: Record<string, unknown>,
  schema: CubeComponentSchemaV1,
  nodeToolMode: boolean,
  selectedOutputIdx: number,
): { config: Record<string, unknown>; didChange: boolean } {
  if (!nodeToolMode) return { config: cfg, didChange: false }
  const cur = cfg['tools_metadata']
  if (Array.isArray(cur) && cur.length > 0) return { config: cfg, didChange: false }
  const arr = buildDefaultToolsMetadataForToolMode(schema, selectedOutputIdx)
  if (arr.length === 0) return { config: cfg, didChange: false }
  return { config: { ...cfg, tools_metadata: arr }, didChange: true }
}

/**
 * Smart Router：与 LF `update_outputs` 一致，按 `routes` 行生成 `category_{i}_result`，可选 `default_result`（Else）。
 */
export function smartRouterOutputsFromConfig(config: Record<string, unknown>): CubeSchemaOutputField[] {
  const routes = config['routes']
  const outs: CubeSchemaOutputField[] = []
  if (Array.isArray(routes)) {
    for (let i = 0; i < routes.length; i++) {
      const row = routes[i]
      let displayName = `Category ${i + 1}`
      if (row && typeof row === 'object') {
        const rc = (row as Record<string, unknown>)['route_category']
        if (typeof rc === 'string' && rc.trim()) displayName = rc.trim()
      }
      outs.push({
        name: `category_${i + 1}_result`,
        displayName,
        types: ['Message'],
        toolMode: false,
        allowsLoop: false,
      })
    }
  }
  if (config['enable_else_output'] === true) {
    outs.push({
      name: 'default_result',
      displayName: 'Else',
      types: ['Message'],
      toolMode: false,
      allowsLoop: false,
    })
  }
  return outs
}

/**
 * 将边上或旧数据里的 Smart Router 输出名规范为 `category_{i}_result` / `default_result`。
 * Langflow cleanEdges 要求 `sourceHandle.name` 与 `inner.outputs[].name` 一致；旧图或误用的协议里可能出现
 * 与 route 展示名相近的片段（如 `test` 对应类别 "TEST"），在此回退匹配。
 */
export function normalizeSmartRouterSemanticOutputName(
  config: Record<string, unknown>,
  rawName: string,
): string {
  const valid = smartRouterOutputsFromConfig(config)
  if (valid.length === 0) return rawName

  const byName = new Set(valid.map((o) => o.name))
  if (byName.has(rawName)) return rawName

  const lower = rawName.toLowerCase()
  for (const o of valid) {
    if (o.name.toLowerCase() === lower) return o.name
  }

  const rawNorm = rawName.trim().toLowerCase()
  for (const o of valid) {
    const label = (o.displayName ?? o.name).trim().toLowerCase()
    if (label === rawNorm) return o.name
  }

  const slug = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_\p{L}\p{N}]/gu, '')
  const rawSlug = slug(rawName)
  if (rawSlug.length > 0) {
    for (const o of valid) {
      if (slug(o.displayName ?? o.name) === rawSlug) return o.name
    }
  }

  return rawName
}

/** 画布可用的输出列表：静态 schema 输出，或对 Smart Router 从 config 合成的动态输出。 */
export function visualSchemaOutputsForNode(
  schema: CubeComponentSchemaV1,
  config: Record<string, unknown>,
  nodeToolMode?: boolean,
): CubeSchemaOutputField[] {
  if (schema.lfComponentKey === 'SmartRouter') {
    return smartRouterOutputsFromConfig(config)
  }
  return filterOutputsForNodeToolMode(schema.outputs, nodeToolMode)
}

/**
 * 可连接端口：输入遵循画布显隐规则；输出按节点 tool 模式过滤。
 * @param fieldEnabled 实例级 show 覆盖，参与 hidden 判断。
 */

/** Parser `mode` 槽：与 LF Tab 一致，放宽空白/大小写，避免序列化差异导致 Stringify 误判。 */
export function cubeConfigParserModeIsStringify(config: Record<string, unknown> | undefined): boolean {
  const m = config?.['mode']
  if (typeof m !== 'string') return false
  return m.trim().toLowerCase() === 'stringify'
}

/**
 * Parser 在 LF Stringify 时 `pattern.show=false`，会经 fieldUi.fieldEnabled 落到 Cube；切回 Parser 后应取消对 pattern 的显隐覆盖，改由 schema.show 决定，否则侧栏 Template 与入桩会一直隐藏。
 */
export function resolveFieldEnabledForCanvas(
  lfComponentKey: string | undefined,
  config: Record<string, unknown> | undefined,
  fieldEnabled: Record<string, boolean> | undefined | null,
): Record<string, boolean> | undefined {
  if (!fieldEnabled) return undefined
  if (lfComponentKey !== 'ParserComponent') return fieldEnabled
  if (cubeConfigParserModeIsStringify(config)) return fieldEnabled
  if (!Object.prototype.hasOwnProperty.call(fieldEnabled, 'pattern')) return fieldEnabled
  const next = { ...fieldEnabled }
  delete next['pattern']
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * Parser：Template（`pattern`）在 Parser 模式下须在基础区可编辑；`fieldUi.fieldAdvanced.pattern` 会把字段只放进「高级」Tab，与 LF 行为不一致，故在非 Stringify 时取消该覆盖。
 */
export function resolveFieldAdvancedForCanvas(
  lfComponentKey: string | undefined,
  config: Record<string, unknown> | undefined,
  fieldAdvanced: Record<string, boolean> | undefined | null,
): Record<string, boolean> | undefined {
  if (!fieldAdvanced) return undefined
  if (lfComponentKey !== 'ParserComponent') return fieldAdvanced
  if (cubeConfigParserModeIsStringify(config)) return fieldAdvanced
  if (!Object.prototype.hasOwnProperty.call(fieldAdvanced, 'pattern')) return fieldAdvanced
  const next = { ...fieldAdvanced }
  delete next['pattern']
  return Object.keys(next).length > 0 ? next : undefined
}

/**
 * 剪枝 / 图校验用入桩：含 advanced 字段；不参与画布 `fieldAdvanced` 折叠（与 LF 可接线输入对齐）。
 * `deriveConnectablePorts` 的入桩会隐藏 advanced，仅用于卡片上画桩；二者混用会误删连到 system_message 等合法边。
 */
export function deriveInputPortIdsForEdgeValidation(
  inputs: readonly CubeSchemaInputField[],
  nodeToolMode?: boolean,
  fieldEnabled?: Record<string, boolean> | null,
  lfComponentKey?: string,
  config?: Record<string, unknown>,
): string[] {
  const feEff = resolveFieldEnabledForCanvas(lfComponentKey, config, fieldEnabled ?? undefined)
  const ids: string[] = []
  for (const f of inputs) {
    if (f.inputTypes.length === 0) continue
    if (templateInputHiddenForToolNode(f, nodeToolMode === true, feEff, f.name)) continue
    ids.push(x6InputPortId(f.name))
  }
  return ids
}

export function deriveConnectablePorts(
  schema: CubeComponentSchemaV1,
  config: Record<string, unknown>,
  fieldEnabled?: Record<string, boolean> | null,
  nodeToolMode?: boolean,
  fieldAdvanced?: Record<string, boolean> | null,
): ConnectablePort[] {
  const feEff = resolveFieldEnabledForCanvas(schema.lfComponentKey, config, fieldEnabled ?? undefined)
  const faEff = resolveFieldAdvancedForCanvas(schema.lfComponentKey, config, fieldAdvanced ?? undefined)
  const outFields = visualSchemaOutputsForNode(schema, config, nodeToolMode)
  const outs: ConnectablePort[] = outFields.map((o) => ({
    kind: 'out' as const,
    x6PortId: x6OutputPortId(o.name),
    logicalName: o.name,
    displayLabel: o.displayName || o.name,
    types: effectiveSchemaOutputTypes(o.types, o.toolMode, nodeToolMode),
    schemaOutputToolMode: o.toolMode,
  }))

  const ins: ConnectablePort[] = []
  for (const f of schema.inputs) {
    if (f.inputTypes.length === 0) continue
    if (!isCanvasVisibleComponentInput(f, nodeToolMode === true, feEff, faEff)) continue
    ins.push({
      kind: 'in',
      x6PortId: x6InputPortId(f.name),
      logicalName: f.name,
      displayLabel: f.displayName || f.name,
      types: [...f.inputTypes],
    })
  }

  return [...ins, ...outs]
}

/** 类型集合可连（交集非空），或任一侧为空则允许（宽松） */
export function portTypesCompatible(sourceTypes: string[], targetTypes: string[]): boolean {
  if (sourceTypes.length === 0 || targetTypes.length === 0) return true
  const a = new Set(sourceTypes)
  for (const t of targetTypes) {
    if (a.has(t)) return true
  }
  return false
}

export function semanticSourcePort(lfNodeId: string, outputName: string): string {
  return `cube.sp/o/${lfNodeId}/${outputName}`
}

export function semanticTargetPort(lfNodeId: string, fieldName: string): string {
  return `cube.sp/i/${lfNodeId}/${fieldName}`
}

export function buildEdgePortData(
  lfSourceNodeId: string,
  sourceLogical: string,
  lfTargetNodeId: string,
  targetLogical: string,
): { cubeSourcePort: string; cubeTargetPort: string } {
  return {
    cubeSourcePort: semanticSourcePort(lfSourceNodeId, sourceLogical),
    cubeTargetPort: semanticTargetPort(lfTargetNodeId, targetLogical),
  }
}

export function isAgentExternalLlmMode(config: Record<string, unknown>): boolean {
  const v = config['model'] ?? config['agent_llm']
  if (v === AGENT_LLM_CONNECT_OTHER) return true
  if (v != null && typeof v !== 'string') return true
  return false
}

/** 切换到「连接其他模型」时清空内置 Provider 字段，与 Langflow `delete_fields(ALL_PROVIDER_FIELDS)` 一致。 */
export function stripAgentProviderFieldsFromConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const next = { ...cfg }
  for (const k of AGENT_PROVIDER_FIELD_NAMES) {
    delete next[k]
  }
  return next
}

/**
 * Agent：`model` / `agent_llm` 为 `connect_other_models`（或 LM 对象）时，与 Langflow 一致显示 **Language Model** 入桩并隐藏内置 Provider 表单项。
 */
export function expandAgentSchemaForCanvas(
  schema: CubeComponentSchemaV1,
  config: Record<string, unknown>,
): CubeComponentSchemaV1 {
  if (schema.lfComponentKey !== 'Agent') return schema
  if (!isAgentExternalLlmMode(config)) return schema

  const inputs = schema.inputs
    .filter((f) => !AGENT_PROVIDER_FIELD_NAME_SET.has(f.name))
    .map((f) => {
      if (!isAgentLlmInputFieldName(f.name)) return f
      return {
        ...f,
        displayName: 'Language Model',
        inputTypes: ['LanguageModel'],
        placeholder: 'Awaiting model input.',
      }
    })

  return { ...schema, inputs }
}

/**
 * Parser：Stringify 模式下 LF 不展示 Template（`pattern`）；Cube 侧同步隐藏该表单项与入桩，避免与 Langflow 行为不一致。
 */
export function expandParserSchemaForCanvas(
  schema: CubeComponentSchemaV1,
  config: Record<string, unknown>,
): CubeComponentSchemaV1 {
  if (schema.lfComponentKey !== 'ParserComponent') return schema
  if (!cubeConfigParserModeIsStringify(config)) return schema

  const inputs = schema.inputs.filter((f) => f.name !== 'pattern')
  const fo = schema.fieldOrder
  if (!fo || fo.length === 0) {
    return { ...schema, inputs }
  }
  const nextFo = fo.filter((n) => n !== 'pattern')
  return {
    ...schema,
    inputs,
    fieldOrder: nextFo.length > 0 ? nextFo : undefined,
  }
}

/**
 * 画布/侧栏共用的 schema 展开链：Prompt 模板变量槽 → Agent 外接 LM 模式 → Parser Stringify。
 */
export function expandSchemaForCubeCanvas(
  schema: CubeComponentSchemaV1,
  customFields: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
  fieldOrderOverride?: string[] | null,
): CubeComponentSchemaV1 {
  return expandParserSchemaForCanvas(
    expandAgentSchemaForCanvas(
      expandPromptTemplateSchemaForCanvas(schema, customFields, config, fieldOrderOverride),
      config,
    ),
    config,
  )
}

/**
 * MCP Tools：`mcpDynamicSchemaInputs` 的镜像副本写入 `CubeFlowNode.config` 此键，
 * 便于服务端 SQLite / API 仅读 `config` 也能还原动态表单项；勿在 LF template 合并中映射。
 * 不在 `MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS` 内，以便切换 tool 时随其它动态参数一并 prune。
 */
export const CUBE_MCPTOOLS_DYNAMIC_SCHEMA_CONFIG_KEY = '__cube_mcp_dynamic_schema_inputs_v1' as const

/**
 * LF `MCPToolsComponent.default_keys` + 设计器侧的 `tools_metadata`。
 * 切换 server/tool 时从 `cubeConfig` 中删除不在此集合内的键（旧工具的动态参数）。
 */
export const MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS = new Set([
  'code',
  '_type',
  'tool_mode',
  'tool_placeholder',
  'mcp_server',
  'tool',
  'use_cache',
  'verify_ssl',
  'tools_metadata',
])

export function pruneMcpToolsNonTemplateConfigKeys(cfg: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cfg)) {
    if (MCPTOOLS_RESERVED_CUBE_CONFIG_KEYS.has(k)) next[k] = v
  }
  return next
}

/** design-time 与 MCP `tools/list` 对齐，用于把真实说明写回 `tools_metadata` 行 */
export type CubeMcpToolListEntry = {
  name: string
  description?: string
  inputSchema?: unknown
}

function bogusMcpToolsMetadataDescription(toolName: string, desc: string): boolean {
  const n = toolName.trim()
  const d = desc.trim()
  if (!d) return true
  if (n && d === `${n}()`) return true
  /** `buildDefaultToolsMetadataForToolMode`：`${schema.displayName}. ${method}()`，如 `MCP Tools. build_output()` */
  if (n) {
    const suf = `${n}()`
    if (d.endsWith(suf)) {
      const before = d.slice(0, d.length - suf.length)
      if (/^.+\.\s+$/.test(before)) return true
    }
  }
  if (/^\w+\(\)$/.test(d)) return true
  return false
}

function mcpToolRootSchemaTitle(inputSchema: unknown): string {
  if (inputSchema == null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return ''
  const t = (inputSchema as Record<string, unknown>)['title']
  return typeof t === 'string' && t.trim() ? t.trim() : ''
}

function mcpToolRootSchemaDescription(inputSchema: unknown): string {
  if (inputSchema == null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return ''
  const d = (inputSchema as Record<string, unknown>)['description']
  return typeof d === 'string' && d.trim() ? d.trim() : ''
}

/**
 * 当已从 MCP 拉到工具说明后，覆盖 reconciler 生成的占位 `description`（如 `foo()`）。
 * 仅在与 `name` 匹配的行上写入；无变化时返回 null。
 */
export function mergeToolsMetadataWithLiveMcpTools(
  cubeConfig: Record<string, unknown> | undefined,
  liveTools: CubeMcpToolListEntry[] | undefined,
): { tools_metadata: unknown[] } | null {
  if (!cubeConfig || !liveTools?.length) return null
  const meta = cubeConfig['tools_metadata']
  if (!Array.isArray(meta) || meta.length === 0) return null
  const byName = new Map<string, CubeMcpToolListEntry>()
  for (const t of liveTools) {
    const n = typeof t.name === 'string' ? t.name.trim() : ''
    if (n) byName.set(n, t as CubeMcpToolListEntry)
  }

  function toolsMetadataRowToolId(row: unknown): string {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return ''
    const n = (row as Record<string, unknown>)['name']
    return typeof n === 'string' ? n.trim() : ''
  }

  /**
   * 占位行（如 hydrate 默认的 `build_output`）与当前 MCP `tools/list` 无一能对上 name 时，
   * 按 Langflow 整包工具模式用 live 列表整表替换 `tools_metadata`（否则 merge 仅原地更新，Actions 永远只有一行）。
   */
  let anyRowMatchesLive = false
  for (const row of meta) {
    const id = toolsMetadataRowToolId(row)
    if (id && byName.has(id)) {
      anyRowMatchesLive = true
      break
    }
  }
  if (!anyRowMatchesLive) {
    const rebuilt: Record<string, unknown>[] = []
    for (const lt of liveTools) {
      const n = typeof lt.name === 'string' ? lt.name.trim() : ''
      if (!n) continue
      let liveDesc = (typeof lt.description === 'string' ? lt.description : '').trim()
      if (!liveDesc) liveDesc = mcpToolRootSchemaDescription(lt.inputSchema)
      const title = mcpToolRootSchemaTitle(lt.inputSchema)
      const human = humanizeSnakeCaseToolId(n)
      const displayName = title && !toolsMetadataActionLabelIsMachineSlug(title, n) ? title : human
      rebuilt.push({
        name: n,
        display_name: displayName,
        display_description: liveDesc,
        description: liveDesc,
        slug: mcpToolSlugFromToolId(n),
        status: true,
        tags: [n],
        args: {} as Record<string, unknown>,
      })
    }
    if (rebuilt.length === 0) return null
    return { tools_metadata: rebuilt }
  }

  let changed = false
  const nextMeta = meta.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row
    const o = { ...(row as Record<string, unknown>) }
    const n = typeof o['name'] === 'string' ? o['name'].trim() : ''
    if (!n) return row
    const lt = byName.get(n)
    if (!lt) return row
    let liveDesc = (typeof lt.description === 'string' ? lt.description : '').trim()
    if (!liveDesc) liveDesc = mcpToolRootSchemaDescription(lt.inputSchema)
    const title = mcpToolRootSchemaTitle(lt.inputSchema)
    const prevDesc = String(o['description'] ?? '').trim()
    const prevDispDesc = String(o['display_description'] ?? '').trim()
    const prevSlug = String(o['slug'] ?? '').trim()
    if (!prevSlug) {
      const sl = mcpToolSlugFromToolId(n)
      if (sl) {
        o['slug'] = sl
        changed = true
      }
    }
    if (liveDesc && (bogusMcpToolsMetadataDescription(n, prevDesc) || prevDesc !== liveDesc)) {
      o['description'] = liveDesc
      if (
        bogusMcpToolsMetadataDescription(n, prevDispDesc) ||
        prevDispDesc === prevDesc ||
        !prevDispDesc
      ) {
        o['display_description'] = liveDesc
      }
      changed = true
    }
    const human = humanizeSnakeCaseToolId(n)
    const prevDn = String(o['display_name'] ?? '').trim()
    let nextDn = prevDn
    if (title && !toolsMetadataActionLabelIsMachineSlug(title, n)) {
      nextDn = title
    } else if (title && toolsMetadataActionLabelIsMachineSlug(title, n)) {
      if (
        !prevDn ||
        prevDn === title ||
        toolsMetadataActionLabelIsMachineSlug(prevDn, n) ||
        prevDn === n
      ) {
        nextDn = human
      }
    } else if (!title) {
      if (!prevDn || prevDn === n || toolsMetadataActionLabelIsMachineSlug(prevDn, n)) {
        nextDn = human
      }
    }
    if (nextDn !== prevDn) {
      o['display_name'] = nextDn
      changed = true
    }
    return o
  })
  if (!changed) return null
  return { tools_metadata: nextMeta }
}

function mcpToolDisplayNameFromKey(name: string, spec: Record<string, unknown>): string {
  const title = spec['title']
  if (typeof title === 'string' && title.trim()) return title.trim()
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * MCP `tools/list` 条目的 `inputSchema`（常为 JSON Schema `object` + `properties`）→ 画布/侧栏用输入定义。
 * 与 Langflow 一致：字符串类参数可接线（`Message`），占位与 LF 接近。
 */
export function mcpToolInputSchemaToCubeSchemaInputs(inputSchema: unknown): CubeSchemaInputField[] {
  if (inputSchema == null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return []
  const root = inputSchema as Record<string, unknown>
  if (root['type'] !== 'object') return []
  const props = root['properties']
  if (props == null || typeof props !== 'object' || Array.isArray(props)) return []
  const required = new Set<string>()
  if (Array.isArray(root['required'])) {
    for (const r of root['required'] as unknown[]) {
      if (typeof r === 'string' && r) required.add(r)
    }
  }

  const out: CubeSchemaInputField[] = []
  for (const [name, spec] of Object.entries(props as Record<string, unknown>)) {
    if (!name || spec == null || typeof spec !== 'object' || Array.isArray(spec)) continue
    const sp = spec as Record<string, unknown>
    const displayName = mcpToolDisplayNameFromKey(name, sp)
    const description = typeof sp['description'] === 'string' ? sp['description'] : ''
    const rawType = sp['type']
    const jsonType = Array.isArray(rawType)
      ? rawType.find((x): x is string => typeof x === 'string')
      : rawType
    const t = typeof jsonType === 'string' ? jsonType : 'string'

    let inputType = 'MessageTextInput'
    let fieldType = 'str'
    /** 与 LF MCP 工具参数一致：多数字段可接 Message */
    let inputTypes: string[] = ['Message']
    let value: unknown = ''

    if (t === 'boolean') {
      inputType = 'BoolInput'
      fieldType = 'bool'
      inputTypes = ['Message', 'Data']
      value = false
    } else if (t === 'integer') {
      inputType = 'IntInput'
      fieldType = 'int'
      inputTypes = ['Message', 'Data']
      value = 0
    } else if (t === 'number') {
      inputType = 'FloatInput'
      fieldType = 'float'
      inputTypes = ['Message', 'Data']
      value = 0
    } else if (t === 'array' || t === 'object') {
      inputType = 'CodeInput'
      fieldType = 'code'
      inputTypes = ['Message', 'Data']
      value = t === 'array' ? '[]' : '{}'
    }

    if ('default' in sp) {
      value = sp['default'] as unknown
      if ((t === 'array' || t === 'object') && (typeof value === 'object' || typeof value === 'number')) {
        try {
          value = JSON.stringify(value)
        } catch {
          value = t === 'array' ? '[]' : '{}'
        }
      }
    }

    out.push({
      name,
      displayName,
      inputTypes,
      advanced: false,
      show: true,
      password: false,
      inputType,
      fieldType,
      info: description,
      required: required.has(name),
      fieldToolMode: false,
      value,
      placeholder: 'Type something...',
    })
  }

  return out
}

/**
 * Langflow `tools_metadata[].args`（Toolset / Actions）：与 LF 持久化形状一致，供右侧 Parameters（Agent Controlled）渲染。
 * 每项为 `{ title, type }`，`type` 为 JSON Schema 原始类型名（如 `string`、`boolean`）。
 */
export function mcpToolInputSchemaToLangflowToolsMetadataArgs(inputSchema: unknown): Record<string, unknown> {
  if (inputSchema == null || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return {}
  const root = inputSchema as Record<string, unknown>
  if (root['type'] !== 'object') return {}
  const props = root['properties']
  if (props == null || typeof props !== 'object' || Array.isArray(props)) return {}
  const out: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(props as Record<string, unknown>)) {
    if (!name || spec == null || typeof spec !== 'object' || Array.isArray(spec)) continue
    const sp = spec as Record<string, unknown>
    const title = mcpToolDisplayNameFromKey(name, sp)
    const rawType = sp['type']
    const jsonType = Array.isArray(rawType)
      ? rawType.find((x): x is string => typeof x === 'string')
      : rawType
    const t = typeof jsonType === 'string' ? jsonType : 'string'
    out[name] = { title, type: t }
  }
  return out
}

/** MCP 工具表格侧栏：JSON Schema 各属性的展示标签（与 {@link mcpToolInputSchemaToCubeSchemaInputs} 一致） */
export function mcpInputSchemaParameterSummaries(
  inputSchema: unknown,
): { name: string; displayLabel: string }[] {
  return mcpToolInputSchemaToCubeSchemaInputs(inputSchema).map((f) => ({
    name: f.name,
    displayLabel: f.displayName,
  }))
}

/**
 * 将当前 tool 的动态参数拼入 MCPTools schema（插在 `tool` 字段之后），用于 hydrate / 侧栏 / 端口。
 */
export function mergeMcpToolsSchemaWithDynamicInputs(
  schema: CubeComponentSchemaV1,
  dynamicFields: readonly CubeSchemaInputField[],
): CubeComponentSchemaV1 {
  if (schema.lfComponentKey !== 'MCPTools' || dynamicFields.length === 0) return schema
  const dedupedStatic = dedupeSchemaInputsByName(schema.inputs)
  const mergeOrderBase = schema.fieldOrder?.length
    ? schema.fieldOrder
    : dedupedStatic.map((f) => f.name)
  const dynamicNames = dynamicFields.map((f) => f.name)
  const ti = mergeOrderBase.indexOf('tool')
  const restStatic = mergeOrderBase.filter((n) => !dynamicNames.includes(n))
  let mergedFieldOrder: string[]
  if (ti >= 0) {
    const before = restStatic.slice(0, ti + 1)
    const after = restStatic.slice(ti + 1)
    mergedFieldOrder = dedupeFieldOrderNames([...before, ...dynamicNames, ...after])
  } else {
    mergedFieldOrder = dedupeFieldOrderNames([...restStatic, ...dynamicNames])
  }
  const mergedInputs = orderInputsByFieldOrder(
    dedupeSchemaInputsByName([...dedupedStatic, ...dynamicFields]),
    mergedFieldOrder,
  )
  return { ...schema, inputs: mergedInputs, fieldOrder: mergedFieldOrder }
}

/**
 * Prompt Template：按模板变量扩展 schema.inputs（Message 入口），与画布端口、配置表单一致。
 */
export function expandPromptTemplateSchemaForCanvas(
  schema: CubeComponentSchemaV1,
  customFields: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
  fieldOrderOverride?: string[] | null,
): CubeComponentSchemaV1 {
  if (schema.lfComponentKey !== 'Prompt Template') return schema

  const deduped = dedupeSchemaInputsByName(schema.inputs)
  const mergeOrder = fieldOrderOverride?.length ? fieldOrderOverride : schema.fieldOrder
  const ordered = orderInputsByFieldOrder(deduped, mergeOrder)
  const promptSlot = findPromptInputSlotName(deduped)
  const varNames = resolvePromptTemplateVariableNames(customFields, config, promptSlot)

  const existing = new Set(deduped.map((f) => f.name))
  const extras: CubeSchemaInputField[] = []
  for (const v of varNames) {
    if (existing.has(v)) continue
    existing.add(v)
    const rawVal = config[v]
    extras.push({
      name: v,
      displayName: v,
      inputTypes: ['Message'],
      advanced: false,
      show: true,
      password: false,
      inputType: 'MessageTextInput',
      fieldType: 'str',
      info: '',
      required: false,
      fieldToolMode: false,
      value: typeof rawVal === 'string' ? rawVal : rawVal == null ? '' : String(rawVal),
    })
  }
  if (extras.length === 0) return schema

  const idx = ordered.findIndex((f) => f.name === promptSlot)
  const insertAt = idx >= 0 ? idx + 1 : ordered.length
  const mergedOrdered = [...ordered.slice(0, insertAt), ...extras, ...ordered.slice(insertAt)]
  const newInputs = dedupeSchemaInputsByName(mergedOrdered)

  return { ...schema, inputs: newInputs }
}

export * from './prompt-template'

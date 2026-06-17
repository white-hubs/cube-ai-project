import { HttpException, Inject, Injectable } from '@dangao/bun-server'
import { APP_CONFIG_TOKEN, type AppConfig } from '@cube-ai/ai-center/platform/server-base'
import {
  CUBE_COMPONENT_SCHEMA_VERSION,
  CUBE_CUSTOM_COMPONENT_DSL_KEY,
  orderInputsByFieldOrder,
  sanitizeFieldOrderForTemplate,
  type CubeComponentSchemaV1,
  type CubeSchemaInputField,
  type CubeSchemaOutputField,
  type CubeTableColumnSpec,
} from '../shared-imports/cube-component-schema'
import { getLfComponentDef } from '../langflow/lf-api-all-registry'

function cubeTypeToLfKey(cubeType: string): string {
  const p = 'cube.lf.'
  if (!cubeType.startsWith(p)) {
    throw new HttpException(422, `Invalid cubeType prefix: ${cubeType}`, { code: 'INVALID_CUBE_TYPE' })
  }
  return cubeType.slice(p.length)
}

function pickOutputs(raw: Record<string, unknown>): CubeSchemaOutputField[] {
  const arr = raw['outputs']
  if (!Array.isArray(arr)) return []
  const out: CubeSchemaOutputField[] = []
  for (const o of arr) {
    if (!o || typeof o !== 'object') continue
    const r = o as Record<string, unknown>
    const name = r['name']
    if (typeof name !== 'string') continue
    const types = Array.isArray(r['types']) ? (r['types'] as unknown[]).filter((t): t is string => typeof t === 'string') : []
    out.push({
      name,
      displayName: typeof r['display_name'] === 'string' ? r['display_name'] : name,
      types,
      toolMode: r['tool_mode'] === true,
      allowsLoop: r['allows_loop'] === true,
      ...(typeof r['method'] === 'string' ? { method: r['method'] } : {}),
    })
  }
  return out
}

function parseExternalConnectAction(raw: unknown): { name: string; displayName: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const fields = (raw as Record<string, unknown>)['fields']
  if (!fields || typeof fields !== 'object') return undefined
  const data = (fields as Record<string, unknown>)['data']
  if (!data || typeof data !== 'object') return undefined
  const node = (data as Record<string, unknown>)['node']
  if (!node || typeof node !== 'object') return undefined
  const n = node as Record<string, unknown>
  const name = typeof n['name'] === 'string' ? n['name'] : undefined
  if (!name) return undefined
  const displayName = typeof n['display_name'] === 'string' ? n['display_name'] : name
  return { name, displayName }
}

function parseTableSchema(raw: unknown): CubeTableColumnSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const cols: CubeTableColumnSpec[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = o['name']
    if (typeof name !== 'string' || !name.trim()) continue
    cols.push({
      name,
      displayName: typeof o['display_name'] === 'string' ? o['display_name'] : name,
      description: typeof o['description'] === 'string' ? o['description'] : undefined,
      type: typeof o['type'] === 'string' ? o['type'] : undefined,
      editMode: typeof o['edit_mode'] === 'string' ? o['edit_mode'] : undefined,
      default: o['default'] !== undefined ? o['default'] : undefined,
    })
  }
  return cols.length > 0 ? cols : undefined
}

function pickInputs(template: Record<string, unknown>): CubeSchemaInputField[] {
  const out: CubeSchemaInputField[] = []
  for (const [key, slot] of Object.entries(template)) {
    if (key === '_type' || key === 'code') continue
    if (!slot || typeof slot !== 'object') continue
    const s = slot as Record<string, unknown>
    const name = typeof s['name'] === 'string' ? s['name'] : key
    const inputTypes = Array.isArray(s['input_types'])
      ? (s['input_types'] as unknown[]).filter((t): t is string => typeof t === 'string')
      : []
    const it = s['_input_type']
    const ft = s['type']
    const externalConnect = parseExternalConnectAction(s['external_options'])
    out.push({
      name,
      displayName: typeof s['display_name'] === 'string' ? s['display_name'] : name,
      inputTypes,
      advanced: s['advanced'] === true,
      show: s['show'] !== false,
      password: s['password'] === true,
      inputType: typeof it === 'string' ? it : 'unknown',
      fieldType: typeof ft === 'string' ? ft : 'unknown',
      info: typeof s['info'] === 'string' ? s['info'] : '',
      required: s['required'] === true,
      fieldToolMode: s['tool_mode'] === true,
      value: s['value'],
      options: s['options'] as unknown[] | undefined,
      rangeSpec: s['range_spec'] && typeof s['range_spec'] === 'object' ? (s['range_spec'] as Record<string, unknown>) : undefined,
      list: s['list'] === true,
      tableSchema: parseTableSchema(s['table_schema']),
      triggerText: typeof s['trigger_text'] === 'string' ? s['trigger_text'] : undefined,
      ...(typeof s['placeholder'] === 'string' && s['placeholder'].length > 0 ? { placeholder: s['placeholder'] } : {}),
      ...(externalConnect ? { externalConnectAction: externalConnect } : {}),
    })
  }
  return out
}

function fieldOrderFromLfDef(def: Record<string, unknown>, template: Record<string, unknown>): string[] | undefined {
  const fo = def['field_order']
  if (!Array.isArray(fo)) return undefined
  const names = fo.filter((x): x is string => typeof x === 'string')
  if (names.length === 0) return undefined
  const cleaned = sanitizeFieldOrderForTemplate(names, template)
  return cleaned.length > 0 ? cleaned : undefined
}

@Injectable()
export class ComponentSchemaService {
  private readonly apiAllPath: string

  constructor(@Inject(APP_CONFIG_TOKEN) config: AppConfig) {
    this.apiAllPath = config.paths.langflowApiAllPath
  }

  getSchemaForCubeType(cubeType: string): CubeComponentSchemaV1 {
    const lfKey = cubeTypeToLfKey(cubeType)
    const def = getLfComponentDef(lfKey, this.apiAllPath)
    if (!def) {
      throw new HttpException(404, `Unknown component: ${cubeType}`, { code: 'COMPONENT_UNKNOWN' })
    }
    const template = def['template']
    if (!template || typeof template !== 'object') {
      throw new HttpException(502, `Component ${cubeType} has no template`, { code: 'SCHEMA_INVALID' })
    }
    const t = { ...(template as Record<string, unknown>) }
    delete t['code']

    const fieldOrder = fieldOrderFromLfDef(def, t)
    const inputs = orderInputsByFieldOrder(pickInputs(t), fieldOrder)

    /** 设计器需根据已选 MCP 服务展示可执行 tool 下拉，模板里常为 show:false */
    if (lfKey === 'MCPTools') {
      const toolInp = inputs.find((i) => i.name === 'tool')
      if (toolInp) {
        toolInp.show = true
        /** 与 LF 工具模式一致：整包工具集时隐藏单 Tool 下拉，靠 `tools_metadata` / Actions 展示 */
        toolInp.fieldToolMode = true
      }
    }

    /** CustomComponent：仅 Cube 侧 DSL；可执行表示仅在服务端同步闭环内生成。 */
    let mergedInputs = inputs
    let mergedFieldOrder = fieldOrder
    if (lfKey === 'CustomComponent') {
      const cubeDslInput: CubeSchemaInputField = {
        name: CUBE_CUSTOM_COMPONENT_DSL_KEY,
        displayName: 'Cube DSL',
        inputTypes: [],
        advanced: false,
        show: true,
        password: false,
        inputType: 'MultilineInput',
        fieldType: 'str',
        info: '使用 JSON 描述本组件逻辑；根上 dslVersion 为 1（线性 steps）或 2（workflow、extends 等）。保存流程后由服务端在同步至执行后端时编译为可运行代码。',
        required: false,
        fieldToolMode: false,
        value: '',
      }
      mergedInputs = [...inputs, cubeDslInput]
      const baseFo =
        fieldOrder ?? mergedInputs.filter((i) => i.name !== CUBE_CUSTOM_COMPONENT_DSL_KEY).map((i) => i.name)
      mergedFieldOrder = baseFo.includes(CUBE_CUSTOM_COMPONENT_DSL_KEY)
        ? baseFo
        : [...baseFo, CUBE_CUSTOM_COMPONENT_DSL_KEY]
    }

    return {
      version: CUBE_COMPONENT_SCHEMA_VERSION,
      cubeType,
      lfComponentKey: lfKey,
      displayName: typeof def['display_name'] === 'string' ? def['display_name'] : lfKey,
      description: typeof def['description'] === 'string' ? def['description'] : '',
      componentToolModeDefault: def['tool_mode'] === true,
      outputs: pickOutputs(def),
      inputs: mergedInputs,
      ...(mergedFieldOrder ? { fieldOrder: [...mergedFieldOrder] } : {}),
    }
  }

  /** 批量解析；未知或非法 cubeType 跳过，不使整个请求失败 */
  getSchemasForCubeTypes(cubeTypes: string[]): CubeComponentSchemaV1[] {
    const seen = new Set<string>()
    const out: CubeComponentSchemaV1[] = []
    for (const raw of cubeTypes) {
      const ct = raw.trim()
      if (!ct || seen.has(ct)) continue
      seen.add(ct)
      try {
        out.push(this.getSchemaForCubeType(ct))
      } catch {
        /* 404 / 422 / 502 等：忽略 */
      }
    }
    return out
  }
}

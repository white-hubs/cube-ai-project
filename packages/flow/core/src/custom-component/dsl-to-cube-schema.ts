import { HttpException } from '@dangao/bun-server'
import {
  CUBE_COMPONENT_SCHEMA_VERSION,
  type CubeComponentSchemaV1,
  type CubeSchemaInputField,
  type CubeSchemaOutputField,
} from '../shared-imports/cube-component-schema'
import {
  cubeCustomComponentDslV2Schema,
  resolveV2ComponentOutputs,
  type CubeCustomComponentDslV2,
} from './dsl-v2.schema'
import type { CubeCustomOutput } from './dsl-shared'
import {
  cubeCustomComponentDslSchema,
  detectCustomDslVersion,
  type CubeCustomComponentDsl,
  type CubeCustomInput,
} from './dsl.schema'

const CUSTOM_CUBE_TYPE = 'cube.lf.CustomComponent' as const

function cubeTypesForOutputKind(kind: CubeCustomOutput['kind']): string[] {
  if (kind === 'data') return ['Data']
  if (kind === 'language_model') return ['LanguageModel']
  return ['Message']
}

function mapInput(inp: CubeCustomInput): CubeSchemaInputField {
  switch (inp.kind) {
    case 'message_text':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: ['Message'],
        advanced: false,
        show: true,
        password: false,
        inputType: 'MessageTextInput',
        fieldType: 'str',
        info: inp.info ?? '',
        required: false,
        fieldToolMode: inp.tool_mode === true,
        value: inp.default,
      }
    case 'str':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [],
        advanced: false,
        show: true,
        password: false,
        inputType: 'StrInput',
        fieldType: 'str',
        info: inp.info ?? '',
        required: inp.required === true,
        fieldToolMode: false,
        value: inp.default,
      }
    case 'bool':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [],
        advanced: false,
        show: true,
        password: false,
        inputType: 'BoolInput',
        fieldType: 'bool',
        info: inp.info ?? '',
        required: false,
        fieldToolMode: false,
        value: inp.default,
      }
    case 'secret_str':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [],
        advanced: false,
        show: true,
        password: true,
        inputType: 'SecretStrInput',
        fieldType: 'str',
        info: inp.info ?? '',
        required: inp.required === true,
        fieldToolMode: false,
        value: '',
      }
    case 'int':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [],
        advanced: false,
        show: true,
        password: false,
        inputType: 'IntInput',
        fieldType: 'int',
        info: inp.info ?? '',
        required: false,
        fieldToolMode: false,
        value: inp.default,
      }
    case 'float':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [],
        advanced: false,
        show: true,
        password: false,
        inputType: 'FloatInput',
        fieldType: 'float',
        info: inp.info ?? '',
        required: false,
        fieldToolMode: false,
        value: inp.default,
      }
    case 'dropdown':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [],
        advanced: false,
        show: true,
        password: false,
        inputType: 'DropdownInput',
        fieldType: 'str',
        info: inp.info ?? '',
        required: false,
        fieldToolMode: false,
        value: inp.default,
        options: inp.options,
      }
    case 'handle':
      return {
        name: inp.name,
        displayName: inp.display_name,
        inputTypes: [...inp.input_types],
        advanced: false,
        show: true,
        password: false,
        inputType: 'HandleInput',
        fieldType: 'other',
        info: inp.info ?? '',
        required: inp.required === true,
        fieldToolMode: false,
        value: '',
        list: inp.is_list === true,
      }
    default: {
      const _never: never = inp
      void _never
      throw new HttpException(500, 'Unknown DSL input shape', { code: 'DSL_INPUT_KIND' })
    }
  }
}

export function parseDslStrict(raw: unknown): CubeCustomComponentDsl | CubeCustomComponentDslV2 {
  if (raw === null || raw === undefined) {
    throw new HttpException(422, 'cube_dsl is required', { code: 'CUSTOM_COMPONENT_DSL_MISSING' })
  }
  let parsed: unknown
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as unknown
    } catch {
      throw new HttpException(422, 'Invalid JSON in cube_dsl', { code: 'CUSTOM_COMPONENT_DSL_INVALID_JSON' })
    }
  } else {
    parsed = raw
  }
  const ver = detectCustomDslVersion(parsed)
  if (ver === 2) {
    const r = cubeCustomComponentDslV2Schema.safeParse(parsed)
    if (!r.success) {
      const detail = r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')
      throw new HttpException(422, `DSL invalid: ${detail}`, { code: 'CUSTOM_COMPONENT_DSL_SCHEMA' })
    }
    return r.data
  }
  const r = cubeCustomComponentDslSchema.safeParse(parsed)
  if (!r.success) {
    const detail = r.error.issues.map((i) => `${i.path.map(String).join('.')}: ${i.message}`).join('; ')
    throw new HttpException(422, `DSL invalid: ${detail}`, { code: 'CUSTOM_COMPONENT_DSL_SCHEMA' })
  }
  return r.data
}

function schemaFromV2(dsl: CubeCustomComponentDslV2): CubeComponentSchemaV1 {
  const inputs = dsl.inputs.map(mapInput)
  const fieldOrder = inputs.map((i) => i.name)
  let outputs: CubeSchemaOutputField[]
  if (dsl.extends === 'vector_store') {
    outputs = [
      {
        name: 'search_results',
        displayName: 'Search Results',
        types: ['Data'],
        toolMode: true,
        allowsLoop: false,
        method: 'search_documents',
      },
      {
        name: 'dataframe',
        displayName: 'DataFrame',
        types: ['DataFrame'],
        toolMode: true,
        allowsLoop: false,
        method: 'as_dataframe',
      },
    ]
  } else {
    const resolved = resolveV2ComponentOutputs(dsl)
    outputs = resolved.map((out) => ({
      name: out.name ?? 'output',
      displayName: out.display_name ?? 'Output',
      types: cubeTypesForOutputKind(out.kind),
      toolMode: true,
      allowsLoop: false,
      method: out.method ?? 'build_output',
    }))
  }
  return {
    version: CUBE_COMPONENT_SCHEMA_VERSION,
    cubeType: CUSTOM_CUBE_TYPE,
    lfComponentKey: 'CustomComponent',
    displayName: dsl.metadata.display_name,
    description: dsl.metadata.description ?? '',
    componentToolModeDefault: false,
    fieldOrder,
    outputs,
    inputs,
  }
}

function schemaFromV1(dsl: CubeCustomComponentDsl): CubeComponentSchemaV1 {
  const inputs = dsl.inputs.map(mapInput)
  const fieldOrder = inputs.map((i) => i.name)
  const out = dsl.output
  const outDisplay = out.display_name ?? 'Output'
  const outName = out.name ?? 'output'
  const outMethod = out.method ?? 'build_output'
  const outputs: CubeSchemaOutputField[] = [
    {
      name: outName,
      displayName: outDisplay,
      types: cubeTypesForOutputKind(out.kind),
      toolMode: true,
      allowsLoop: false,
      method: outMethod,
    },
  ]
  return {
    version: CUBE_COMPONENT_SCHEMA_VERSION,
    cubeType: CUSTOM_CUBE_TYPE,
    lfComponentKey: 'CustomComponent',
    displayName: dsl.metadata.display_name,
    description: dsl.metadata.description ?? '',
    componentToolModeDefault: false,
    fieldOrder,
    outputs,
    inputs,
  }
}

/**
 * 由已校验的 `cube_dsl`（JSON 对象或 JSON 字符串）生成设计器用 Cube 组件 schema（无桩上 MultilineInput DSL 行）。
 */
export function buildCubeComponentSchemaFromDslPayload(raw: unknown): CubeComponentSchemaV1 {
  const parsed = parseDslStrict(raw)
  return parsed.dslVersion === 2 ? schemaFromV2(parsed) : schemaFromV1(parsed)
}

/** 同步至 Langflow 时写回 inner.display_name / icon 等用 */
export function readCustomDslMetadataForLf(raw: unknown): {
  display_name: string
  description: string
  icon: string
} {
  const p = parseDslStrict(raw)
  return {
    display_name: p.metadata.display_name,
    description: p.metadata.description ?? '',
    icon: p.metadata.icon ?? 'code',
  }
}

import type { CubeCustomComponentDsl, CubeCustomInput } from './dsl.schema'
import type { CubeCustomOutput } from './dsl-shared'
import { cubeCustomComponentDslSchema } from './dsl.schema'
import { collectPipFromSteps, emitOperatorStep } from './operators'

const NL = '\n'

function pyReprStr(s: string): string {
  return JSON.stringify(s)
}

function inputToPythonArgLines(inp: CubeCustomInput, indent: string): string[] {
  const lines: string[] = [`${indent}name=${pyReprStr(inp.name)},`]
  lines.push(`${indent}display_name=${pyReprStr(inp.display_name)},`)
  if (inp.info) lines.push(`${indent}info=${pyReprStr(inp.info)},`)
  switch (inp.kind) {
    case 'message_text': {
      /** 与 api-all 默认 CustomComponent 字段顺序一致：value 在 tool_mode 之前 */
      if (inp.default !== undefined) lines.push(`${indent}value=${pyReprStr(inp.default)},`)
      if (inp.tool_mode !== undefined) lines.push(`${indent}tool_mode=${inp.tool_mode ? 'True' : 'False'},`)
      break
    }
    case 'str': {
      if (inp.required !== undefined) lines.push(`${indent}required=${inp.required ? 'True' : 'False'},`)
      if (inp.default !== undefined) lines.push(`${indent}value=${pyReprStr(inp.default)},`)
      break
    }
    case 'bool': {
      if (inp.default !== undefined) lines.push(`${indent}value=${inp.default ? 'True' : 'False'},`)
      break
    }
    case 'secret_str': {
      if (inp.required !== undefined) lines.push(`${indent}required=${inp.required ? 'True' : 'False'},`)
      lines.push(`${indent}password=True,`)
      break
    }
    case 'int': {
      if (inp.default !== undefined) lines.push(`${indent}value=${inp.default},`)
      break
    }
    case 'float': {
      if (inp.default !== undefined) lines.push(`${indent}value=${inp.default},`)
      break
    }
    case 'dropdown': {
      lines.push(`${indent}options=${JSON.stringify(inp.options)},`)
      if (inp.default !== undefined) lines.push(`${indent}value=${pyReprStr(inp.default)},`)
      break
    }
    case 'handle': {
      lines.push(`${indent}input_types=${JSON.stringify(inp.input_types)},`)
      if (inp.is_list !== undefined) lines.push(`${indent}is_list=${inp.is_list ? 'True' : 'False'},`)
      if (inp.required !== undefined) lines.push(`${indent}required=${inp.required ? 'True' : 'False'},`)
      break
    }
    default: {
      const _x: never = inp
      void _x
    }
  }
  /** 保留末行逗号，与 api-all / Black 风格及 LF 导出一致 */
  return lines
}

function inputConstructorCall(inp: CubeCustomInput): { line: string; importPiece: string } {
  const innerIndent = '            '
  const argLines = inputToPythonArgLines(inp, innerIndent)
  switch (inp.kind) {
    case 'message_text':
      return {
        importPiece: 'MessageTextInput',
        line: `MessageTextInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'str':
      return {
        importPiece: 'StrInput',
        line: `StrInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'bool':
      return {
        importPiece: 'BoolInput',
        line: `BoolInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'secret_str':
      return {
        importPiece: 'SecretStrInput',
        line: `SecretStrInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'int':
      return {
        importPiece: 'IntInput',
        line: `IntInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'float':
      return {
        importPiece: 'FloatInput',
        line: `FloatInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'dropdown':
      return {
        importPiece: 'DropdownInput',
        line: `DropdownInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    case 'handle':
      return {
        importPiece: 'HandleInput',
        line: `HandleInput(${NL}${argLines.join(NL)}${NL}        ),`,
      }
    default: {
      const _x: never = inp
      void _x
      return { importPiece: 'StrInput', line: `StrInput(name="x", display_name="x"),` }
    }
  }
}

/** CustomComponent 生成代码所需的 schema / typing 导入（可多选并存） */
export type ComponentOutputSchemaKind = 'data' | 'message' | 'language_model'

/** @deprecated 使用 ComponentOutputSchemaKind */
export type CustomComponentRootOutputImportKind = ComponentOutputSchemaKind

function normalizeOutputSchemaKinds(
  rootOutput: ComponentOutputSchemaKind | readonly ComponentOutputSchemaKind[],
): Set<ComponentOutputSchemaKind> {
  return new Set(Array.isArray(rootOutput) ? rootOutput : [rootOutput])
}

export function buildStaticImports(
  inputs: CubeCustomInput[],
  rootOutput: ComponentOutputSchemaKind | readonly ComponentOutputSchemaKind[] = 'data',
): string[] {
  const io = new Set<string>()
  for (const i of inputs) {
    io.add(inputConstructorCall(i).importPiece)
  }
  io.add('Output')
  const ioLine = `from lfx.io import ${[...io].sort().join(', ')}`
  const kinds = normalizeOutputSchemaKinds(rootOutput)
  const schemaLines: string[] = []
  if (kinds.has('data')) schemaLines.push('from lfx.schema.data import Data')
  if (kinds.has('message')) schemaLines.push('from lfx.schema.message import Message')
  if (kinds.has('language_model')) schemaLines.push('from lfx.field_typing import LanguageModel')
  return ['from lfx.custom.custom_component.component import Component', ioLine, ...schemaLines]
}

/** 由若干输出的 kind 汇总导入集合（compile-v2 多输出） */
export function collectOutputSchemaKinds(outputs: Pick<CubeCustomOutput, 'kind'>[]): ComponentOutputSchemaKind[] {
  const out = new Set<ComponentOutputSchemaKind>()
  for (const o of outputs) {
    if (o.kind === 'data') out.add('data')
    else if (o.kind === 'message' || o.kind === 'text') out.add('message')
    else if (o.kind === 'language_model') out.add('language_model')
  }
  if (out.size === 0) out.add('data')
  return [...out]
}

export function buildMessageOutputNormalizationLines(
  targetVar: string,
  sourceExpr: string,
  valueVar: string,
  indent: string,
): string[] {
  return [
    `${indent}${valueVar} = ${sourceExpr}`,
    `${indent}${targetVar} = ${valueVar} if isinstance(${valueVar}, Message) else Message(text=str(${valueVar}) if ${valueVar} is not None else "", sender="Machine", sender_name="AI")`,
    `${indent}if getattr(${targetVar}, "text", None) is None:`,
    `${indent}    ${targetVar}.text = ""`,
    `${indent}if not getattr(${targetVar}, "sender", None):`,
    `${indent}    ${targetVar}.sender = "Machine"`,
    `${indent}if not getattr(${targetVar}, "sender_name", None):`,
    `${indent}    ${targetVar}.sender_name = "AI"`,
  ]
}

function exprFromOutputBinding(
  lastExpr: string,
  valueFrom: string | undefined,
  inputNames: Set<string>,
): string {
  const v = valueFrom?.trim()
  if (!v) return lastExpr
  if (inputNames.has(v)) return `self.${v}`
  return v
}

/** api-all 默认桩首行注释（与 LF 导出一致） */
export const CUSTOM_COMPONENT_HEADER_COMMENT = '# from lfx.field_typing import Data'

export function renderPythonInputFields(inputs: CubeCustomInput[]): string[] {
  return inputs.map((inp) => `        ${inputConstructorCall(inp).line}`)
}

export function buildVectorStoreStaticImports(inputs: CubeCustomInput[]): string[] {
  const io = new Set<string>()
  for (const i of inputs) {
    io.add(inputConstructorCall(i).importPiece)
  }
  const ioLine = `from lfx.io import ${[...io].sort().join(', ')}`
  return [
    'from lfx.base.vectorstores.model import LCVectorStoreComponent',
    ioLine,
    'from lfx.schema.data import Data',
  ]
}

export function transpileCustomComponentDsl(raw: unknown): string {
  const dsl = cubeCustomComponentDslSchema.parse(raw)
  return transpileParsedDsl(dsl)
}

export function transpileParsedDsl(dsl: CubeCustomComponentDsl): string {
  const cls = dsl.metadata.name.replace(/[^a-zA-Z0-9_]/g, '_') || 'CustomComponent'
  const docLine = dsl.metadata.documentation
    ? `    documentation: str = ${pyReprStr(dsl.metadata.documentation)}`
    : null
  const desc = dsl.metadata.description ?? ''
  const icon = dsl.metadata.icon ?? 'code'

  const isMessageOut = dsl.output.kind === 'message' || dsl.output.kind === 'text'
  const isLanguageModelOut = dsl.output.kind === 'language_model'
  if (!isMessageOut && !isLanguageModelOut && dsl.output.kind !== 'data') {
    throw new Error(`custom component DSL: output kind "${dsl.output.kind}" not implemented yet`)
  }

  const schemaKinds: ComponentOutputSchemaKind[] = isLanguageModelOut
    ? ['language_model']
    : isMessageOut
      ? ['message']
      : ['data']
  const staticImports = buildStaticImports(dsl.inputs, schemaKinds)
  const extraImports = new Set<string>()
  const inputLines = renderPythonInputFields(dsl.inputs)

  const outDisplay = dsl.output.display_name ?? 'Output'
  const outName = dsl.output.name ?? 'output'
  const outMethod = dsl.output.method

  const wrapTry = dsl.metadata.wrap_build_in_try

  const stepInnerLines: string[] = []
  let lastValueExpr = ''
  if (dsl.steps.length === 0) {
    const first = dsl.inputs[0]
    if (!first) throw new Error('custom component DSL: no inputs')
    lastValueExpr = `self.${first.name}`
  } else {
    for (let i = 0; i < dsl.steps.length; i++) {
      const emitted = emitOperatorStep(dsl.steps[i]!, `_s${i}`)
      for (const im of emitted.imports) {
        extraImports.add(im)
      }
      for (const ln of emitted.lines) {
        stepInnerLines.push(`            ${ln}`)
      }
      lastValueExpr = `_s${i}`
    }
  }

  const inputNames = new Set(dsl.inputs.map((i) => i.name))
  const boundExpr = exprFromOutputBinding(lastValueExpr, dsl.output.value_from, inputNames)

  const finishLines = isLanguageModelOut
    ? [`        _out = ${boundExpr}`, `        self.status = _out`, `        return _out`]
    : isMessageOut
      ? [
          ...buildMessageOutputNormalizationLines('msg', boundExpr, '_cube_message_value', '        '),
          `        self.status = msg`,
          `        return msg`,
        ]
      : [`        data = Data(value=${boundExpr})`, `        self.status = data`, `        return data`]

  let methodBody: string
  if (wrapTry) {
    methodBody = [
      `        try:`,
      ...stepInnerLines,
      ...finishLines.map((l) => `            ${l.trimStart()}`),
      `        except Exception as e:`,
      `            raise RuntimeError(f"CustomComponent build failed: {e!s}") from e`,
    ].join(NL)
  } else {
    if (stepInnerLines.length === 0) {
      methodBody = finishLines.join(NL)
    } else {
      methodBody = [...stepInnerLines.map((l) => l.replace(/^            /, '        ')), ...finishLines].join(NL)
    }
  }

  const importSection = [
    CUSTOM_COMPONENT_HEADER_COMMENT,
    ...[...extraImports].sort(),
    ...staticImports,
  ].join(NL)

  const parts: string[] = [
    importSection,
    '',
    '',
    `class ${cls}(Component):`,
    `    display_name = ${pyReprStr(dsl.metadata.display_name)}`,
    `    description = ${pyReprStr(desc)}`,
  ]
  if (docLine) parts.push(docLine)
  parts.push(`    icon = ${pyReprStr(icon)}`)
  parts.push(`    name = ${pyReprStr(dsl.metadata.name)}`)
  parts.push('')
  parts.push('    inputs = [')
  parts.push(inputLines.join(NL))
  parts.push('    ]')
  parts.push('')
  parts.push('    outputs = [')
  parts.push(
    `        Output(display_name=${pyReprStr(outDisplay)}, name=${pyReprStr(outName)}, method=${pyReprStr(outMethod)}),`,
  )
  parts.push('    ]')
  parts.push('')
  const retAnn = isLanguageModelOut ? 'LanguageModel' : isMessageOut ? 'Message' : 'Data'
  parts.push(`    def ${outMethod}(self) -> ${retAnn}:`)
  parts.push(methodBody)

  return parts.join(NL) + NL
}

/** 与 api-all 默认 CustomComponent 对齐的 DSL（黄金测试 identity） */
export function defaultCustomComponentIdentityDsl(): CubeCustomComponentDsl {
  return {
    dslVersion: 1,
    metadata: {
      name: 'CustomComponent',
      display_name: 'Custom Component',
      description: 'Use as a template to create your own component.',
      icon: 'code',
      documentation: 'https://docs.langflow.org/components-custom-components',
      wrap_build_in_try: false,
    },
    inputs: [
      {
        kind: 'message_text',
        name: 'input_value',
        display_name: 'Input Value',
        info: 'This is a custom component Input',
        default: 'Hello, World!',
        tool_mode: true,
      },
    ],
    output: { kind: 'data', method: 'build_output', display_name: 'Output', name: 'output' },
    steps: [],
  }
}

export function listPipForDsl(dsl: CubeCustomComponentDsl): { name: string; version?: string }[] {
  return collectPipFromSteps(dsl.steps)
}

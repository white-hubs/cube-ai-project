import type { CubeCustomOutput } from './dsl-shared'
import type { CubeCustomComponentDslV2 } from './dsl-v2.schema'
import { cubeCustomComponentDslV2Schema, resolveV2ComponentOutputs } from './dsl-v2.schema'
import { buildMethodBodyV2 } from './workflow-emit-v2'
import {
  CUSTOM_COMPONENT_HEADER_COMMENT,
  buildMessageOutputNormalizationLines,
  buildStaticImports,
  buildVectorStoreStaticImports,
  collectOutputSchemaKinds,
  renderPythonInputFields,
} from './transpile'

const NL = '\n'

function pyReprStr(s: string): string {
  return JSON.stringify(s)
}

function dedupePip(pip: { name: string; version?: string }[]): { name: string; version?: string }[] {
  const seen = new Set<string>()
  const out: { name: string; version?: string }[] = []
  for (const p of pip) {
    if (seen.has(p.name)) continue
    seen.add(p.name)
    out.push(p)
  }
  return out
}

function refOutputExpr(
  valueFrom: string | undefined,
  lastExpr: string,
  inputNames: Set<string>,
): string {
  const v = valueFrom?.trim()
  if (!v) return lastExpr
  if (inputNames.has(v)) return `self.${v}`
  return v
}

function returnTypeForOutput(out: CubeCustomOutput): string {
  if (out.kind === 'message' || out.kind === 'text') return 'Message'
  if (out.kind === 'language_model') return 'LanguageModel'
  return 'Data'
}

function finishLinesForOutput(out: CubeCustomOutput, expr: string, baseIndent: string): string[] {
  if (out.kind === 'message' || out.kind === 'text') {
    return [
      ...buildMessageOutputNormalizationLines('msg', expr, '_cube_message_value', baseIndent),
      `${baseIndent}self.status = msg`,
      `${baseIndent}return msg`,
    ]
  }
  if (out.kind === 'language_model') {
    return [
      `${baseIndent}_lm = ${expr}`,
      `${baseIndent}self.status = _lm`,
      `${baseIndent}return _lm`,
    ]
  }
  return [
    `${baseIndent}data = Data(value=${expr})`,
    `${baseIndent}self.status = data`,
    `${baseIndent}return data`,
  ]
}

export function compileCustomComponentDslV2(raw: unknown): string {
  const dsl = cubeCustomComponentDslV2Schema.parse(raw)
  return compileParsedDslV2(dsl)
}

export function compileParsedDslV2(dsl: CubeCustomComponentDslV2): string {
  const cls = dsl.metadata.name.replace(/[^a-zA-Z0-9_]/g, '_') || 'CustomComponent'
  const docLine = dsl.metadata.documentation
    ? `    documentation: str = ${pyReprStr(dsl.metadata.documentation)}`
    : null
  const desc = dsl.metadata.description ?? ''
  const icon = dsl.metadata.icon ?? 'code'
  const wrapTry = dsl.metadata.wrap_build_in_try

  const baseIndent = wrapTry ? '            ' : '        '
  const { innerLines, lastExpr, imports: extraImports, pip } = buildMethodBodyV2(dsl, baseIndent)
  const inputNames = new Set(dsl.inputs.map((i) => i.name))

  let methodBody: string
  if (dsl.extends === 'vector_store') {
    const finish = [`${baseIndent}return ${lastExpr}`]
    if (wrapTry) {
      methodBody = [
        '        try:',
        ...innerLines,
        ...finish,
        '        except Exception as e:',
        '            raise RuntimeError(f"CustomComponent build failed: {e!s}") from e',
      ].join(NL)
    } else {
      methodBody = [...innerLines, ...finish].join(NL)
    }
  } else {
    const resolved = resolveV2ComponentOutputs(dsl)
    for (const o of resolved) {
      const isM = o.kind === 'message' || o.kind === 'text'
      if (!isM && o.kind !== 'data' && o.kind !== 'language_model') {
        throw new Error(
          `DSL v2: output kind "${o.kind}" not implemented (use data, message, text, or language_model)`,
        )
      }
    }

    if (resolved.length === 1) {
      const out = resolved[0]!
      const expr = refOutputExpr(out.value_from, lastExpr, inputNames)
      const fl = finishLinesForOutput(out, expr, baseIndent)
      if (wrapTry) {
        methodBody = [
          '        try:',
          ...innerLines,
          ...fl,
          '        except Exception as e:',
          '            raise RuntimeError(f"CustomComponent build failed: {e!s}") from e',
        ].join(NL)
      } else {
        methodBody = [...innerLines, ...fl].join(NL)
      }
    } else {
      const assignLines: string[] = []
      for (let i = 0; i < resolved.length; i++) {
        const o = resolved[i]!
        const expr = refOutputExpr(o.value_from, lastExpr, inputNames)
        if (o.kind === 'message' || o.kind === 'text') {
          assignLines.push(
            ...buildMessageOutputNormalizationLines(
              `self._cube_o${i}`,
              expr,
              `_cube_o${i}_value`,
              baseIndent,
            ),
          )
        } else {
          assignLines.push(`${baseIndent}self._cube_o${i} = ${expr}`)
        }
      }
      const doneLine = `${baseIndent}self._cube_workflow_done = True`
      if (wrapTry) {
        methodBody = [
          '    def _cube_run_workflow_once(self) -> None:',
          '        if getattr(self, "_cube_workflow_done", False):',
          '            return',
          '        try:',
          ...innerLines,
          ...assignLines,
          doneLine,
          '        except Exception as e:',
          '            raise RuntimeError(f"CustomComponent build failed: {e!s}") from e',
        ].join(NL)
      } else {
        methodBody = [
          '    def _cube_run_workflow_once(self) -> None:',
          '        if getattr(self, "_cube_workflow_done", False):',
          '            return',
          ...innerLines,
          ...assignLines,
          doneLine,
        ].join(NL)
      }
    }
  }

  const resolvedForImports =
    dsl.extends === 'vector_store' ? null : resolveV2ComponentOutputs(dsl)
  const staticImports =
    dsl.extends === 'vector_store'
      ? buildVectorStoreStaticImports(dsl.inputs)
      : buildStaticImports(
          dsl.inputs,
          resolvedForImports ? collectOutputSchemaKinds(resolvedForImports) : 'data',
        )
  const inputLines = renderPythonInputFields(dsl.inputs)

  const metaComments: string[] = []
  if (dsl.traits && dsl.traits.length > 0) {
    metaComments.push(`# cube DSL traits: ${dsl.traits.join(', ')}`)
  }
  if (dsl.ui_rules && dsl.ui_rules.length > 0) {
    metaComments.push(`# cube DSL ui_rules: ${JSON.stringify(dsl.ui_rules)}`)
  }

  const importSection = [
    CUSTOM_COMPONENT_HEADER_COMMENT,
    ...metaComments,
    ...[...extraImports].sort(),
    ...staticImports,
  ].join(NL)

  const baseClass = dsl.extends === 'vector_store' ? 'LCVectorStoreComponent' : 'Component'
  const parts: string[] = [
    importSection,
    '',
    '',
    `class ${cls}(${baseClass}):`,
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

  if (dsl.extends === 'component') {
    const resolved = resolveV2ComponentOutputs(dsl)
    parts.push('    outputs = [')
    for (const o of resolved) {
      const outDisplay = o.display_name ?? 'Output'
      const outName = o.name ?? 'output'
      const outMethod = o.method ?? 'build_output'
      parts.push(
        `        Output(display_name=${pyReprStr(outDisplay)}, name=${pyReprStr(outName)}, method=${pyReprStr(outMethod)}),`,
      )
    }
    parts.push('    ]')
    parts.push('')

    if (resolved.length === 1) {
      const o = resolved[0]!
      const outMethod = o.method ?? 'build_output'
      parts.push(`    def ${outMethod}(self) -> ${returnTypeForOutput(o)}:`)
      parts.push(methodBody)
    } else {
      parts.push(methodBody)
      for (let i = 0; i < resolved.length; i++) {
        const o = resolved[i]!
        const outMethod = o.method ?? 'build_output'
        parts.push(`    def ${outMethod}(self) -> ${returnTypeForOutput(o)}:`)
        parts.push(`        self._cube_run_workflow_once()`)
        parts.push(`        return self._cube_o${i}`)
        parts.push('')
      }
    }
  } else {
    parts.push(`    def search_documents(self) -> list[Data]:`)
    parts.push(methodBody)
  }

  return parts.join(NL) + NL
}

export function listPipForDslV2(dsl: CubeCustomComponentDslV2): { name: string; version?: string }[] {
  const baseIndent = dsl.metadata.wrap_build_in_try ? '            ' : '        '
  return dedupePip(buildMethodBodyV2(dsl, baseIndent).pip)
}

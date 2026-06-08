import type { CubeCondition, CubeWorkflowBlock } from './dsl-v2.schema'
import type { CubeCustomComponentDslV2 } from './dsl-v2.schema'
import { emitOperatorStep, expandPlaceholders, type OperatorEmit, type OperatorStep } from './operators'

export type EmitV2Deps = {
  imports: Set<string>
  pip: { name: string; version?: string }[]
}

function timeoutSecondsFromMs(raw: unknown, fallbackMs = 30000): string {
  const timeoutMs =
    typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : fallbackMs
  return String(timeoutMs / 1000)
}

function refExpr(field: string, inputNames: Set<string>): string {
  if (inputNames.has(field)) return `self.${field}`
  return field
}

export function emitConditionPy(cond: CubeCondition, inputNames: Set<string>): string {
  switch (cond.kind) {
    case 'non_empty': {
      const r = refExpr(cond.field, inputNames)
      return `(isinstance(${r}, str) and ${r}.strip() != "") or (not isinstance(${r}, str) and bool(${r}))`
    }
    case 'is_truthy':
      return `bool(${refExpr(cond.field, inputNames)})`
    case 'equals': {
      const r = refExpr(cond.field, inputNames)
      const v = cond.value
      if (typeof v === 'string') return `${r} == ${JSON.stringify(v)}`
      if (typeof v === 'boolean') return `${r} is ${v ? 'True' : 'False'}`
      return `${r} == ${v}`
    }
    case 'and':
      return `(${cond.conditions.map((c) => emitConditionPy(c, inputNames)).join(' and ')})`
    case 'or':
      return `(${cond.conditions.map((c) => emitConditionPy(c, inputNames)).join(' or ')})`
    case 'not':
      return `(not (${emitConditionPy(cond.condition, inputNames)}))`
    default: {
      const _x: never = cond
      void _x
      return 'False'
    }
  }
}

function pathToPyAccess(itemVar: string, path: string): string {
  const trimmed = path.trim()
  if (trimmed === '' || trimmed === '$') return itemVar
  const rest = trimmed.startsWith('$.') ? trimmed.slice(2) : trimmed.startsWith('$') ? trimmed.slice(1) : trimmed
  const parts = rest.split('.').filter((p) => p !== '')
  if (parts.length === 0) return itemVar
  let acc = itemVar
  for (const p of parts) {
    acc = `(${acc}.get(${JSON.stringify(p)}) if isinstance(${acc}, dict) else getattr(${acc}, ${JSON.stringify(p)}, None))`
  }
  return acc
}

/** 与 operators 中占位符规则一致；无占位符的字符串必须输出为 Python 引号字面量，否则如 application/json 会变成未定义的 application 标识符。 */
const DSL_PLACEHOLDER_RE = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/

function valueToPyLiteralOrExpr(
  val: unknown,
  inputNames: Set<string>,
): string {
  if (val === null) return 'None'
  if (typeof val === 'boolean') return val ? 'True' : 'False'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'string') {
    if (!DSL_PLACEHOLDER_RE.test(val)) {
      return JSON.stringify(val)
    }
    return expandPlaceholders(val, inputNames)
  }
  if (Array.isArray(val)) {
    const inner = val.map((x) => valueToPyLiteralOrExpr(x, inputNames)).join(', ')
    return `[${inner}]`
  }
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>
    const pairs = Object.entries(o).map(
      ([k, v]) => `${JSON.stringify(k)}: ${valueToPyLiteralOrExpr(v, inputNames)}`,
    )
    return `{${pairs.join(', ')}}`
  }
  return 'None'
}

export function emitHttpStructured(
  params: Record<string, unknown>,
  targetVar: string,
  inputNames: Set<string>,
): OperatorEmit {
  const method = typeof params['method'] === 'string' ? params['method'].toUpperCase() : 'GET'
  const url = expandPlaceholders(String(params['url'] ?? ''), inputNames)
  const headersObj = params['headers'] as Record<string, unknown> | undefined
  const queryObj = params['query'] as Record<string, unknown> | undefined
  const bodyType = typeof params['body_type'] === 'string' ? params['body_type'] : 'none'
  const bodyVal = params['body']

  const hVar = `${targetVar}_h`
  const lines: string[] = []
  if (headersObj && typeof headersObj === 'object' && !Array.isArray(headersObj)) {
    const pairs = Object.entries(headersObj).map(
      ([k, v]) => `${JSON.stringify(k)}: ${valueToPyLiteralOrExpr(v, inputNames)}`,
    )
    lines.push(`${hVar} = {${pairs.join(', ')}}`)
  } else {
    lines.push(`${hVar} = {}`)
  }

  const hasQuery =
    queryObj && typeof queryObj === 'object' && !Array.isArray(queryObj) && Object.keys(queryObj).length > 0
  if (hasQuery) {
    const qPairs = Object.entries(queryObj!).map(
      ([k, v]) => `${JSON.stringify(k)}: ${valueToPyLiteralOrExpr(v, inputNames)}`,
    )
    lines.push(`${targetVar}_q = {${qPairs.join(', ')}}`)
  }

  const mutating = method === 'POST' || method === 'PUT' || method === 'PATCH'
  let dataKw: string | null = null
  if (bodyType === 'json' && mutating) {
    const bodyExpr =
      typeof bodyVal === 'object' && bodyVal !== null && !Array.isArray(bodyVal)
        ? valueToPyLiteralOrExpr(bodyVal, inputNames)
        : expandPlaceholders(String(bodyVal ?? '{}'), inputNames)
    lines.push(`${targetVar}_body = json.dumps(${bodyExpr})`)
    lines.push(`${hVar}[${JSON.stringify('Content-Type')}] = ${JSON.stringify('application/json')}`)
    dataKw = `data=${targetVar}_body`
  } else if (bodyType === 'raw' && mutating && bodyVal != null && String(bodyVal) !== '') {
    dataKw = `data=${expandPlaceholders(String(bodyVal), inputNames)}`
  }

  const kw: string[] = [`headers=${hVar}`]
  if (hasQuery) kw.push(`params=${targetVar}_q`)
  if (dataKw) kw.push(dataKw)
  kw.push(`timeout=${timeoutSecondsFromMs(params['timeout_ms'])}`)
  lines.push(`${targetVar} = requests.request(${JSON.stringify(method)}, ${url}, ${kw.join(', ')}).text`)

  return {
    lines,
    imports: ['import requests', 'import json'],
    pip: [{ name: 'requests' }],
  }
}

export function emitTransform(
  params: Record<string, unknown>,
  targetVar: string,
  itemVar: string,
  fromExpr: string,
  inputNames: Set<string>,
): OperatorEmit {
  const mapping = params['mapping'] as Record<string, unknown> | undefined
  const textPath =
    mapping && typeof mapping['text'] === 'string' ? (mapping['text'] as string) : '$.text'
  const dataMap = mapping && typeof mapping['data'] === 'object' && mapping['data'] !== null
    ? (mapping['data'] as Record<string, unknown>)
    : undefined

  const textPy = pathToPyAccess(itemVar, textPath)
  const dataPairs: string[] = []
  if (dataMap) {
    for (const [dk, pathRaw] of Object.entries(dataMap)) {
      if (typeof pathRaw !== 'string') continue
      dataPairs.push(`${JSON.stringify(dk)}: ${pathToPyAccess(itemVar, pathRaw)}`)
    }
  }

  const lines = [
    `${targetVar} = []`,
    `for ${itemVar} in ${fromExpr}:`,
    `    if ${itemVar} is None:`,
    `        continue`,
    `    ${targetVar}.append(Data(`,
    `        text=str(${textPy}) if ${textPy} is not None else "",`,
    `        data={${dataPairs.join(', ')}},`,
    `    ))`,
  ]
  return { lines, imports: [] }
}

let tempSeq = 0

export function resetEmitV2Temp(): void {
  tempSeq = 0
}

function nextTemp(): string {
  tempSeq += 1
  return `_t${tempSeq}`
}

export function emitWorkflowBlocksV2(
  blocks: CubeWorkflowBlock[],
  baseIndent: string,
  inputNames: Set<string>,
  scopeVars: Set<string>,
  pathPrefix: string,
  deps: EmitV2Deps,
): { lines: string[]; lastValueExpr: string | null } {
  const lines: string[] = []
  let lastValue: string | null = null

  const pushEmit = (em: OperatorEmit) => {
    for (const im of em.imports) deps.imports.add(im)
    if (em.pip) deps.pip.push(...em.pip)
    for (const ln of em.lines) {
      lines.push(baseIndent + ln)
    }
  }

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]!

    if (block.type === 'op') {
      const targetVar = block.output_as ?? nextTemp()
      if (block.output_as) scopeVars.add(block.output_as)

      if (block.action === 'http') {
        const em = emitHttpStructured(block.params, targetVar, inputNames)
        pushEmit(em)
      } else if (block.action === 'transform') {
        const fromRaw = typeof block.params['from'] === 'string' ? block.params['from'] : ''
        const fromExpr = expandPlaceholders(fromRaw, inputNames)
        const itemVar =
          typeof block.params['item_var'] === 'string' ? (block.params['item_var'] as string) : '_it'
        const em = emitTransform(block.params, targetVar, itemVar, fromExpr, inputNames)
        pushEmit(em)
      } else {
        const step = {
          action: block.action,
          params: block.params,
        } as OperatorStep
        const em = emitOperatorStep(step, targetVar, inputNames)
        pushEmit(em)
      }
      lastValue = targetVar
      continue
    }

    if (block.type === 'if') {
      const condPy = emitConditionPy(block.condition, inputNames)
      lines.push(`${baseIndent}if ${condPy}:`)
      const thenRes = emitWorkflowBlocksV2(
        block.then,
        baseIndent + '    ',
        inputNames,
        new Set(scopeVars),
        `${pathPrefix}.blocks[${bi}].then`,
        deps,
      )
      lines.push(...thenRes.lines)
      const thenLast = thenRes.lastValueExpr
      if (block.else && block.else.length > 0) {
        lines.push(`${baseIndent}else:`)
        const elseRes = emitWorkflowBlocksV2(
          block.else,
          baseIndent + '    ',
          inputNames,
          new Set(scopeVars),
          `${pathPrefix}.blocks[${bi}].else`,
          deps,
        )
        lines.push(...elseRes.lines)
        lastValue = elseRes.lastValueExpr ?? thenLast ?? lastValue
      } else {
        lastValue = thenLast ?? lastValue
      }
      continue
    }

    if (block.type === 'foreach') {
      const overExpr = expandPlaceholders(block.over, inputNames)
      lines.push(`${baseIndent}for ${block.as} in ${overExpr}:`)
      const bodyRes = emitWorkflowBlocksV2(
        block.body,
        baseIndent + '    ',
        inputNames,
        new Set(scopeVars),
        `${pathPrefix}.blocks[${bi}].body`,
        deps,
      )
      lines.push(...bodyRes.lines)
      lastValue = bodyRes.lastValueExpr ?? lastValue
    }
  }

  return { lines, lastValueExpr: lastValue }
}

export function buildMethodBodyV2(
  dsl: CubeCustomComponentDslV2,
  baseIndent: string,
): {
  innerLines: string[]
  lastExpr: string
  imports: Set<string>
  pip: { name: string; version?: string }[]
} {
  resetEmitV2Temp()
  const inputNames = new Set(dsl.inputs.map((i) => i.name))
  const scopeVars = new Set<string>()
  for (const v of dsl.variables ?? []) {
    scopeVars.add(v.name)
  }

  const deps: EmitV2Deps = { imports: new Set<string>(), pip: [] }
  const initLines: string[] = []
  for (const v of dsl.variables ?? []) {
    const init = v.initial !== undefined && v.initial !== '' ? v.initial : 'None'
    initLines.push(`${baseIndent}${v.name} = ${init}`)
  }

  const wf = emitWorkflowBlocksV2(
    dsl.workflow.blocks,
    baseIndent,
    inputNames,
    scopeVars,
    'workflow',
    deps,
  )
  const innerLines = [...initLines, ...wf.lines]

  let lastExpr = wf.lastValueExpr
  if (lastExpr === null) {
    if (dsl.variables?.length) {
      lastExpr = dsl.variables[dsl.variables.length - 1]!.name
    } else {
      lastExpr = `self.${dsl.inputs[0]!.name}`
    }
  }

  return { innerLines, lastExpr, imports: deps.imports, pip: deps.pip }
}

/**
 * Cube Run / Playground 请求体 v2（与 protocol-v1.md 对齐；向后兼容 v1 平铺字段）。
 */

export type CubeRunUserContext = {
  user_id?: string
  org_id?: string
  project_id?: string
  /** W3C / 自定义 trace，可选覆盖服务端生成 */
  trace_id?: string
  ext?: Record<string, unknown>
}

export type CubeRunRuntimeConfig = {
  stream?: boolean
  max_iterations?: number
  timeout_ms?: number
  ext?: Record<string, unknown>
}

export type CubeRunInputFileRef = {
  id?: string
  name?: string
  path?: string
  file_path?: string
  filePath?: string
  url?: string
  mime?: string
  ext?: Record<string, unknown>
}

export type CubeRunInputV2 = {
  /** 主查询文本；兼容旧版顶位 `input` */
  query?: string
  /** 业务语义参数；与节点 `tweaks` 合并时 tweaks 优先显式覆盖 */
  params?: Record<string, unknown>
  files?: CubeRunInputFileRef[]
  /** 无状态模式：可选对话历史（产品侧自管） */
  history?: Array<{ role: string; content: string; ext?: Record<string, unknown> }>
  ext?: Record<string, unknown>
}

/** 规范化后的单次执行选项（供 Langflow 适配层使用） */
export type NormalizedRunBody = {
  flow_version?: string
  input: string
  sessionId?: string
  stream?: boolean
  inputType?: string
  outputType?: string
  tweaks?: Record<string, Record<string, unknown>>
  user_context: CubeRunUserContext
  runtime_config: CubeRunRuntimeConfig
  metadata?: Record<string, unknown>
  input_files?: CubeRunInputFileRef[]
  ext?: Record<string, unknown>
}

function asRecord(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>
  return null
}

function mergeTweaks(
  fromParams: Record<string, unknown> | undefined,
  tweaks: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  const out: Record<string, Record<string, unknown>> = {}
  if (fromParams && typeof fromParams === 'object') {
    for (const [k, v] of Object.entries(fromParams)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = { ...(v as Record<string, unknown>) }
      }
    }
  }
  if (tweaks) {
    for (const [nodeId, patch] of Object.entries(tweaks)) {
      out[nodeId] = { ...(out[nodeId] ?? {}), ...patch }
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function normalizeInputFiles(raw: unknown): CubeRunInputFileRef[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: CubeRunInputFileRef[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed) out.push({ file_path: trimmed })
      continue
    }
    const rec = asRecord(item)
    if (!rec) continue
    const ref: CubeRunInputFileRef = {}
    for (const key of ['id', 'name', 'path', 'file_path', 'filePath', 'url', 'mime'] as const) {
      const value = rec[key]
      if (typeof value === 'string' && value.trim()) {
        ref[key] = value.trim()
      }
    }
    const ext = rec['ext']
    if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
      ref.ext = ext as Record<string, unknown>
    }
    if (ref.file_path || ref.path || ref.filePath || ref.url || ref.id) {
      out.push(ref)
    }
  }
  return out.length > 0 ? out : undefined
}

/**
 * 将 HTTP JSON body 规范为 NormalizedRunBody。兼容 v1：`input` 字符串 + `tweaks`。
 */
export function normalizeRunBody(raw: unknown): NormalizedRunBody {
  const o = asRecord(raw) ?? {}

  const flow_version = typeof o['flow_version'] === 'string' ? o['flow_version'] : undefined
  const sessionId = typeof o['sessionId'] === 'string' ? o['sessionId'] : undefined
  const stream = typeof o['stream'] === 'boolean' ? o['stream'] : undefined
  const inputType = typeof o['inputType'] === 'string' ? o['inputType'] : undefined
  const outputType = typeof o['outputType'] === 'string' ? o['outputType'] : undefined
  const tweaksIn = o['tweaks'] as Record<string, Record<string, unknown>> | undefined

  const userRaw = o['user_context']
  const user_context: CubeRunUserContext =
    userRaw && typeof userRaw === 'object' && !Array.isArray(userRaw)
      ? (userRaw as CubeRunUserContext)
      : {}

  const runtimeRaw = o['runtime_config']
  const runtime_config: CubeRunRuntimeConfig =
    runtimeRaw && typeof runtimeRaw === 'object' && !Array.isArray(runtimeRaw)
      ? { ...(runtimeRaw as CubeRunRuntimeConfig) }
      : {}

  if (typeof runtime_config.stream !== 'boolean' && typeof stream === 'boolean') {
    runtime_config.stream = stream
  }

  const metadata = o['metadata'] as Record<string, unknown> | undefined
  const extTop = o['ext'] as Record<string, unknown> | undefined

  let input = ''
  const inputField = o['input']
  const structured = o['input'] && typeof o['input'] === 'object' && !Array.isArray(o['input'])

  if (structured) {
    const inv2 = o['input'] as CubeRunInputV2
    if (typeof inv2.query === 'string') input = inv2.query
    const merged = mergeTweaks(inv2.params as Record<string, unknown> | undefined, tweaksIn)
    const tweaks = merged
    const input_files = normalizeInputFiles(inv2.files)
    return {
      flow_version,
      input,
      sessionId,
      stream: runtime_config.stream ?? stream,
      inputType,
      outputType,
      tweaks,
      user_context,
      runtime_config,
      metadata,
      input_files,
      ext: extTop,
    }
  }

  if (typeof inputField === 'string') {
    input = inputField
  }

  const merged = mergeTweaks(undefined, tweaksIn)

  return {
    flow_version,
    input,
    sessionId,
    stream: runtime_config.stream ?? stream,
    inputType,
    outputType,
    tweaks: merged,
    user_context,
    runtime_config,
    metadata,
    ext: extTop,
  }
}

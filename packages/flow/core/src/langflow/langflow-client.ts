export type LangflowClientConfig = {
  baseUrl: string
  apiKey?: string
  bearerToken?: string
}

/** 携带 HTTP 状态，便于调用方区分 404（远端已删）等 */
export class LangflowRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodyText: string,
    /** PATCH/GET 等返回 200 + HTML 等非 JSON 时，可由上层新建 flow 并重绑 id */
    readonly rebindSuggested?: boolean,
  ) {
    super(message)
    this.name = 'LangflowRequestError'
  }
}

function envTruthy(name: string): boolean {
  const v = process.env[name]
  if (!v) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes'
}

/** Shell 单引号内安全转义，用于复制 curl（须设置 CUBE_AI_LOG_LF_CURL=1，日志含密钥）。 */
function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export class LangflowClient {
  constructor(private readonly cfg: LangflowClientConfig) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' }
    if (this.cfg.bearerToken) {
      h['Authorization'] = `Bearer ${this.cfg.bearerToken}`
    } else if (this.cfg.apiKey) {
      h['x-api-key'] = this.cfg.apiKey
    }
    return h
  }

  /** GET 请求不应带 body；少数网关/Langflow 版本对 GET + Content-Type 表现异常，Monitor 等只读接口单独使用。 */
  private headersForGet(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' }
    if (this.cfg.bearerToken) {
      h['Authorization'] = `Bearer ${this.cfg.bearerToken}`
    } else if (this.cfg.apiKey) {
      h['x-api-key'] = this.cfg.apiKey
    }
    return h
  }

  /** multipart/form-data 由 fetch/FormData 自动设置 boundary，不能手动带 Content-Type。 */
  private headersForFormData(): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json' }
    if (this.cfg.bearerToken) {
      h['Authorization'] = `Bearer ${this.cfg.bearerToken}`
    } else if (this.cfg.apiKey) {
      h['x-api-key'] = this.cfg.apiKey
    }
    return h
  }

  /**
   * 将即将发往 Langflow 的请求打印为可复制 curl（含完整 Header 与 body）。
   * 启用：`CUBE_AI_LOG_LF_CURL=1` 启动 server（日志含 x-api-key / Bearer，勿提交或转发）。
   */
  private logOutgoingCurl(label: string, method: string, url: string, headersInit: Record<string, string> | Headers, body?: string): void {
    if (!envTruthy('CUBE_AI_LOG_LF_CURL')) return
    const h = headersInit instanceof Headers ? headersInit : new Headers(headersInit)
    const lines: string[] = [`curl -sS -X ${method} ${shellSingleQuote(url)}`]
    const names: string[] = []
    h.forEach((_v, k) => names.push(k))
    names.sort()
    for (const k of names) {
      const v = h.get(k)
      if (v != null) lines.push(`  -H ${shellSingleQuote(`${k}: ${v}`)}`)
    }
    if (body !== undefined && body.length > 0 && method !== 'GET' && method !== 'HEAD') {
      lines.push(`  --data-raw ${shellSingleQuote(body)}`)
    }
    const curl = lines.join(' \\\n')
    console.log(`\n[cube-ai][lf-curl] === ${label} ===\n${curl}\n`)
  }

  /**
   * Vite / SPA 常对未知路由回退 index.html，仍返回 200，导致误配 LANGFLOW_BASE_URL 时「解析 JSON」失败。
   */
  private rejectIfHtmlMaskedAsOk(context: string, res: Response, text: string): void {
    if (!res.ok) return
    const trimmed = text.trim()
    if (!trimmed) return
    const ct = (res.headers.get('content-type') ?? '').toLowerCase()
    const head = trimmed.slice(0, 32).toLowerCase()
    if (ct.includes('text/html') || head.startsWith('<!doctype') || head.startsWith('<html')) {
      const origin = this.cfg.baseUrl.replace(/\/$/, '')
      const rebindSuggested =
        context === 'Langflow PATCH flow' || context === 'Langflow GET flow'
      const baseMsg = rebindSuggested
        ? `${context}: Langflow returned HTTP ${res.status} with HTML instead of JSON (known LF quirk on some errors). Wrong LANGFLOW_BASE_URL also looks like this — fix base URL if every request returns HTML.`
        : `${context}: response is HTML (SPA), not JSON — LANGFLOW_BASE_URL (${origin}) targets the web UI or a dev fallback, not the Langflow API. Point it at the backend where GET /api/v1/flows/<id> returns application/json.`
      throw new LangflowRequestError(baseMsg, res.status, text.slice(0, 400), rebindSuggested)
    }
  }

  private parseJsonOrThrow(label: string, status: number, text: string): Record<string, unknown> {
    const t = text.trim()
    if (!t) {
      throw new LangflowRequestError(`${label}: empty response body`, status, text)
    }
    try {
      return JSON.parse(t) as Record<string, unknown>
    } catch {
      throw new LangflowRequestError(`${label}: Failed to parse JSON`, status, text.slice(0, 500))
    }
  }

  private async jsonFetch(label: string, url: string, init: RequestInit): Promise<unknown> {
    const res = await fetch(url, init)
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`${label} ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk(label, res, text)
    if (!text.trim()) return {}
    try {
      return JSON.parse(text.trim()) as unknown
    } catch {
      return { raw: text }
    }
  }

  private async fileFetch(label: string, url: string, init: RequestInit): Promise<Response> {
    const res = await fetch(url, init)
    if (!res.ok) {
      const text = await res.text()
      throw new LangflowRequestError(`${label} ${res.status}`, res.status, text)
    }
    return res
  }

  async getFlow(flowId: string): Promise<Record<string, unknown>> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/flows/${encodeURIComponent(flowId)}`
    const res = await fetch(url, { headers: this.headers() })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow GET flow ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow GET flow', res, text)
    return this.parseJsonOrThrow('Langflow GET flow', res.status, text)
  }

  /**
   * Langflow 各版本 PATCH 成功时 body 不一致：空、非 JSON 纯文本、或完整 JSON。
   * 空或非 JSON 时以 GET 完整文档为准。
   */
  async patchFlow(flowId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/flows/${encodeURIComponent(flowId)}`
    const res = await fetch(url, { method: 'PATCH', headers: this.headers(), body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow PATCH flow ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow PATCH flow', res, text)
    const trimmed = text.trim()
    if (!trimmed) return this.getFlow(flowId)
    try {
      return JSON.parse(trimmed) as Record<string, unknown>
    } catch {
      return this.getFlow(flowId)
    }
  }

  async createFlow(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/flows/`
    const res = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow POST flow ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow POST flow', res, text)
    return this.parseJsonOrThrow('Langflow POST flow', res.status, text)
  }

  /**
   * `DELETE /api/v1/flows/{flow_id}` — 远端已不存在时 404 视为成功（幂等）。
   */
  async deleteFlow(flowId: string): Promise<void> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/flows/${encodeURIComponent(flowId)}`
    this.logOutgoingCurl('deleteFlow (DELETE /api/v1/flows/{id})', 'DELETE', url, this.headers())
    const res = await fetch(url, { method: 'DELETE', headers: this.headers() })
    const text = await res.text()
    if (res.status === 404) return
    if (!res.ok) throw new LangflowRequestError(`Langflow DELETE flow ${res.status}`, res.status, text)
  }

  async runFlow(
    flowIdOrName: string,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/run/${encodeURIComponent(flowIdOrName)}`
    this.logOutgoingCurl('runFlow (sync /api/v1/run)', 'POST', url, this.headers(), JSON.stringify(payload))
    const res = await fetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify(payload) })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow run ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow run', res, text)
    return this.parseJsonOrThrow('Langflow run', res.status, text)
  }

  /**
   * 文档推荐的外部流式入口：`POST /api/v1/run/{flow_id}?stream=true` + body `input_request`（与 runFlow 相同）。
   * @see https://docs.langflow.org/api-reference-api-examples
   */
  async openRunStream(flowIdOrName: string, payload: Record<string, unknown>): Promise<Response> {
    const path = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/run/${encodeURIComponent(flowIdOrName)}`
    const url = `${path}?${new URLSearchParams({ stream: 'true' })}`
    const h = new Headers(this.headers())
    h.set('Accept', 'text/event-stream, application/json, */*')
    const jsonBody = JSON.stringify(payload)
    this.logOutgoingCurl('openRunStream (POST /api/v1/run?stream=true)', 'POST', url, h, jsonBody)
    return fetch(url, { method: 'POST', headers: h, body: jsonBody })
  }

  async startBuildFlow(flowId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    /** 与 langflow-frontend `run-execution-model` 一致，显式 streaming 投递（默认在不同版本上可能不同）。 */
    const path = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/build/${encodeURIComponent(flowId)}/flow`
    const url = `${path}?${new URLSearchParams({ event_delivery: 'streaming' })}`
    const jsonBody = JSON.stringify(body)
    this.logOutgoingCurl('startBuildFlow (stream POST /api/v1/build/{flow}/flow)', 'POST', url, this.headers(), jsonBody)
    const res = await fetch(url, { method: 'POST', headers: this.headers(), body: jsonBody })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow build ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow build', res, text)
    return this.parseJsonOrThrow('Langflow build', res.status, text)
  }

  async openBuildEventsStream(jobId: string): Promise<Response> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/build/${encodeURIComponent(jobId)}/events`
    const h = new Headers(this.headers())
    h.set('Accept', 'text/event-stream')
    this.logOutgoingCurl(`openBuildEventsStream (GET /api/v1/build/${jobId}/events)`, 'GET', url, h)
    return fetch(url, { headers: h })
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/monitor/messages/session/${encodeURIComponent(sessionId)}`
    this.logOutgoingCurl('deleteChatSession (DELETE /api/v1/monitor/messages/session/{sessionId})', 'DELETE', url, this.headers())
    const res = await fetch(url, { method: 'DELETE', headers: this.headers() })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow DELETE chat ${res.status}`, res.status, text)
  }

  /**
   * Langflow 1.8+ Monitor：`GET /api/v1/monitor/traces`（trace 元数据、总延迟等）。
   * @see https://docs.langflow.org/1.8.0/api-monitor
   */
  async getMonitorTraces(searchParams: URLSearchParams): Promise<Record<string, unknown>> {
    const qs = searchParams.toString()
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/monitor/traces${qs ? `?${qs}` : ''}`
    this.logOutgoingCurl('getMonitorTraces (GET /api/v1/monitor/traces)', 'GET', url, this.headersForGet())
    const res = await fetch(url, { headers: this.headersForGet() })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow GET monitor/traces ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow GET monitor/traces', res, text)
    return this.parseJsonOrThrow('Langflow GET monitor/traces', res.status, text)
  }

  /**
   * Langflow Playground 侧各顶点构建记录（含每组件 `timedelta` / `duration`）。
   * `GET /api/v1/monitor/builds?flow_id=...`
   * @see https://docs.langflow.org/1.8.0/api-monitor
   */
  async getMonitorBuilds(searchParams: URLSearchParams): Promise<Record<string, unknown>> {
    const qs = searchParams.toString()
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/monitor/builds${qs ? `?${qs}` : ''}`
    this.logOutgoingCurl('getMonitorBuilds (GET /api/v1/monitor/builds)', 'GET', url, this.headersForGet())
    const res = await fetch(url, { headers: this.headersForGet() })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow GET monitor/builds ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow GET monitor/builds', res, text)
    return this.parseJsonOrThrow('Langflow GET monitor/builds', res.status, text)
  }

  /**
   * 解析 `GET /api/v2/mcp/servers` 的 JSON（各版本/代理可能包装不同）。
   * @see https://docs.langflow.org/api#tag/MCP
   */
  parseMcpV2ServersResponseBody(text: string): string[] {
    let raw: unknown
    try {
      raw = JSON.parse(text) as unknown
    } catch {
      return []
    }
    return extractMcpServerNamesFromJson(raw)
  }

  /** Langflow 全局 MCP 列表：`GET /api/v2/mcp/servers`（不传 action_count，避免逐台探测工具） */
  async listMcpV2Servers(): Promise<string[]> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/mcp/servers`
    const res = await fetch(url, { headers: this.headers() })
    const text = await res.text()
    if (!res.ok) throw new LangflowRequestError(`Langflow GET mcp/servers ${res.status}`, res.status, text)
    this.rejectIfHtmlMaskedAsOk('Langflow GET mcp/servers', res, text)
    return this.parseMcpV2ServersResponseBody(text)
  }

  /**
   * `POST /api/v2/mcp/servers/{server_name}`，body 为 Langflow `MCPServerConfig`（url、headers、command 等）。
   * 若服务端返回「已存在」类 500，视为成功（幂等）。
   */
  async addMcpV2Server(serverName: string, config: Record<string, unknown>): Promise<void> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/mcp/servers/${encodeURIComponent(serverName)}`
    const body = JSON.stringify(config)
    this.logOutgoingCurl('addMcpV2Server (POST /api/v2/mcp/servers/...)', 'POST', url, this.headers(), body)
    const res = await fetch(url, { method: 'POST', headers: this.headers(), body })
    const text = await res.text()
    if (res.ok) return
    if (res.status === 409) return
    if (res.status === 500 || res.status === 422) {
      const low = text.toLowerCase()
      if (low.includes('already exists') || low.includes('server already')) return
    }
    throw new LangflowRequestError(`Langflow POST mcp/servers/${serverName} ${res.status}`, res.status, text)
  }

  /** `GET /api/v1/files/list/{flow_id}` */
  async listFlowFiles(flowId: string): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/list/${encodeURIComponent(flowId)}`
    this.logOutgoingCurl('listFlowFiles (GET /api/v1/files/list/{flow_id})', 'GET', url, this.headersForGet())
    return this.jsonFetch('Langflow GET flow files', url, { headers: this.headersForGet() })
  }

  /** `POST /api/v1/files/upload/{flow_id}` */
  async uploadFlowFile(flowId: string, file: File): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/upload/${encodeURIComponent(flowId)}`
    const form = new FormData()
    form.set('file', file)
    this.logOutgoingCurl('uploadFlowFile (POST /api/v1/files/upload/{flow_id})', 'POST', url, this.headersForFormData())
    return this.jsonFetch('Langflow POST flow file', url, {
      method: 'POST',
      headers: this.headersForFormData(),
      body: form,
    })
  }

  /** `GET /api/v1/files/download/{flow_id}/{file_name}` */
  async downloadFlowFile(flowId: string, fileName: string): Promise<Response> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/download/${encodeURIComponent(flowId)}/${encodeURIComponent(fileName)}`
    const h = new Headers(this.headersForGet())
    h.set('Accept', '*/*')
    this.logOutgoingCurl('downloadFlowFile (GET /api/v1/files/download/{flow_id}/{file_name})', 'GET', url, h)
    return this.fileFetch('Langflow GET flow file', url, { headers: h })
  }

  /** `GET /api/v1/files/images/{flow_id}/{file_name}` */
  async downloadFlowImage(flowId: string, fileName: string): Promise<Response> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/images/${encodeURIComponent(flowId)}/${encodeURIComponent(fileName)}`
    const h = new Headers(this.headersForGet())
    h.set('Accept', 'image/*, */*')
    this.logOutgoingCurl('downloadFlowImage (GET /api/v1/files/images/{flow_id}/{file_name})', 'GET', url, h)
    return this.fileFetch('Langflow GET flow image', url, { headers: h })
  }

  /** `DELETE /api/v1/files/delete/{flow_id}/{file_name}` */
  async deleteFlowFile(flowId: string, fileName: string): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/delete/${encodeURIComponent(flowId)}/${encodeURIComponent(fileName)}`
    this.logOutgoingCurl('deleteFlowFile (DELETE /api/v1/files/delete/{flow_id}/{file_name})', 'DELETE', url, this.headers())
    return this.jsonFetch('Langflow DELETE flow file', url, { method: 'DELETE', headers: this.headers() })
  }

  /** `GET /api/v1/files/profile_pictures/list` */
  async listProfilePictures(): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/profile_pictures/list`
    this.logOutgoingCurl('listProfilePictures (GET /api/v1/files/profile_pictures/list)', 'GET', url, this.headersForGet())
    return this.jsonFetch('Langflow GET profile pictures', url, { headers: this.headersForGet() })
  }

  /** `GET /api/v1/files/profile_pictures/{folder_name}/{file_name}` */
  async downloadProfilePicture(folderName: string, fileName: string): Promise<Response> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v1/files/profile_pictures/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`
    const h = new Headers(this.headersForGet())
    h.set('Accept', 'image/*, */*')
    this.logOutgoingCurl('downloadProfilePicture (GET /api/v1/files/profile_pictures/{folder}/{file})', 'GET', url, h)
    return this.fileFetch('Langflow GET profile picture', url, { headers: h })
  }

  /** `GET /api/v2/files` */
  async listUserFiles(): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files`
    this.logOutgoingCurl('listUserFiles (GET /api/v2/files)', 'GET', url, this.headersForGet())
    return this.jsonFetch('Langflow GET user files', url, { headers: this.headersForGet() })
  }

  /** `POST /api/v2/files?append=...` */
  async uploadUserFile(file: File, append?: boolean): Promise<unknown> {
    const qs = append === undefined ? '' : `?${new URLSearchParams({ append: append ? 'true' : 'false' })}`
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files${qs}`
    const form = new FormData()
    form.set('file', file)
    this.logOutgoingCurl('uploadUserFile (POST /api/v2/files)', 'POST', url, this.headersForFormData())
    return this.jsonFetch('Langflow POST user file', url, {
      method: 'POST',
      headers: this.headersForFormData(),
      body: form,
    })
  }

  /** `GET /api/v2/files/{file_id}` */
  async downloadUserFile(fileId: string, returnContent?: boolean): Promise<Response> {
    const qs = returnContent === undefined ? '' : `?${new URLSearchParams({ return_content: returnContent ? 'true' : 'false' })}`
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files/${encodeURIComponent(fileId)}${qs}`
    const h = new Headers(this.headersForGet())
    h.set('Accept', '*/*')
    this.logOutgoingCurl('downloadUserFile (GET /api/v2/files/{file_id})', 'GET', url, h)
    return this.fileFetch('Langflow GET user file', url, { headers: h })
  }

  /** `DELETE /api/v2/files/{file_id}` */
  async deleteUserFile(fileId: string): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files/${encodeURIComponent(fileId)}`
    this.logOutgoingCurl('deleteUserFile (DELETE /api/v2/files/{file_id})', 'DELETE', url, this.headers())
    return this.jsonFetch('Langflow DELETE user file', url, { method: 'DELETE', headers: this.headers() })
  }

  /** `DELETE /api/v2/files` */
  async deleteAllUserFiles(): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files`
    this.logOutgoingCurl('deleteAllUserFiles (DELETE /api/v2/files)', 'DELETE', url, this.headers())
    return this.jsonFetch('Langflow DELETE all user files', url, { method: 'DELETE', headers: this.headers() })
  }

  /** `DELETE /api/v2/files/batch/` */
  async deleteUserFilesBatch(fileIds: string[]): Promise<unknown> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files/batch/`
    const body = JSON.stringify(fileIds)
    this.logOutgoingCurl('deleteUserFilesBatch (DELETE /api/v2/files/batch/)', 'DELETE', url, this.headers(), body)
    return this.jsonFetch('Langflow DELETE user files batch', url, {
      method: 'DELETE',
      headers: this.headers(),
      body,
    })
  }

  /** `POST /api/v2/files/batch/` */
  async downloadUserFilesBatch(fileIds: string[]): Promise<Response> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files/batch/`
    const h = new Headers(this.headers())
    h.set('Accept', '*/*')
    const body = JSON.stringify(fileIds)
    this.logOutgoingCurl('downloadUserFilesBatch (POST /api/v2/files/batch/)', 'POST', url, h, body)
    return this.fileFetch('Langflow POST user files batch', url, {
      method: 'POST',
      headers: h,
      body,
    })
  }

  /** `PUT /api/v2/files/{file_id}?name=...` */
  async renameUserFile(fileId: string, name: string): Promise<unknown> {
    const qs = new URLSearchParams({ name })
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/api/v2/files/${encodeURIComponent(fileId)}?${qs}`
    this.logOutgoingCurl('renameUserFile (PUT /api/v2/files/{file_id})', 'PUT', url, this.headers())
    return this.jsonFetch('Langflow PUT user file name', url, { method: 'PUT', headers: this.headers() })
  }
}

/** Best-effort job id from Langflow build/start responses (shape varies by version). */
/** 从 Langflow MCP list / 文件形响应中提取 server 名 */
export function extractMcpServerNamesFromJson(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    const names: string[] = []
    for (const row of raw) {
      if (typeof row === 'string' && row.trim()) {
        names.push(row.trim())
        continue
      }
      if (row && typeof row === 'object' && !Array.isArray(row)) {
        const o = row as Record<string, unknown>
        const n = o['name']
        if (typeof n === 'string' && n.trim()) {
          names.push(n.trim())
          continue
        }
        const sn = o['server_name']
        if (typeof sn === 'string' && sn.trim()) names.push(sn.trim())
      }
    }
    return names
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    const data = o['data']
    if (data !== undefined) return extractMcpServerNamesFromJson(data)
    const ms = o['mcpServers']
    if (ms != null && typeof ms === 'object' && !Array.isArray(ms)) {
      return Object.keys(ms as Record<string, unknown>).filter((k) => k.trim() !== '')
    }
  }
  return []
}

export function extractBuildJobId(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null
  const r = obj as Record<string, unknown>
  for (const k of ['job_id', 'jobId', 'build_id', 'buildId']) {
    const v = r[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  for (const nested of [r['data'], r['job'], r['build']]) {
    const inner = extractBuildJobId(nested)
    if (inner) return inner
  }
  const id = r['id']
  if (typeof id === 'string' && id.length > 0) return id
  return null
}

/** @deprecated 改用 langflowConfigFromAppConfig，通过 DI 注入 AppConfig */
export function langflowConfigFromEnv(): LangflowClientConfig | null {
  const baseUrl = process.env['LANGFLOW_BASE_URL']
  if (!baseUrl) return null
  const apiKey = process.env['LANGFLOW_API_KEY']
  const bearerToken = process.env['LANGFLOW_BEARER_TOKEN']
  return { baseUrl, apiKey, bearerToken }
}

import type { AppConfig } from '@cube-ai/ai-center/platform/server-base'

export function langflowConfigFromAppConfig(config: AppConfig): LangflowClientConfig | null {
  if (!config.langflowBaseUrl) return null
  return {
    baseUrl: config.langflowBaseUrl,
    apiKey: config.langflowApiKey,
    bearerToken: config.langflowBearerToken,
  }
}

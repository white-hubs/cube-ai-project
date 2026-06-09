import { HttpException } from '@dangao/bun-server'
import { safeFetchJson } from '../../util/safe-http'
import type { LlmRemoteModelItem } from '../metadata-inference.service'

export interface LlmProviderConnectionPayload {
  typeCode: string
  apiBaseUrl: string
  apiKey: string | null
}

export interface LlmModelConnectionPayload extends LlmProviderConnectionPayload {
  modelCode: string
  endpointType: string | null
  modelTypes: string[]
}

export interface LlmTypeAdapter {
  testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }>
  fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]>
  testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }>
}

type FetchInput = string | URL
type HeaderInitLike = Record<string, string>
type RequestInitLike = {
  method?: string
  headers?: HeaderInitLike
  body?: string
}

interface OpenAiResponse {
  data?: Array<{ id?: string }>
}

interface AnthropicModelListResponse {
  data?: Array<{ id?: string; display_name?: string }>
}

interface OllamaResponse {
  models?: Array<{ name?: string }>
}

function buildJsonResponse(body: unknown): { ok: boolean; message: string } {
  return {
    ok: true,
    message: typeof body === 'object' && body !== null ? '检测成功' : '检测成功',
  }
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function readJson<T>(input: FetchInput, init?: RequestInitLike): Promise<T> {
  return safeFetchJson<T>(input, init)
}

function toModelItems(ids: string[], groupName: string): LlmRemoteModelItem[] {
  return ids
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => ({
      modelCode: id,
      displayName: id,
      groupName,
    }))
}

function ensureSupportedModelDetection(payload: LlmModelConnectionPayload): void {
  if (payload.modelTypes.includes('rerank')) {
    throw new HttpException(400, '重排模型暂不支持检测')
  }
}

function isDashscopeImageModel(payload: LlmModelConnectionPayload): boolean {
  return payload.endpointType === 'dashscope_text2image' || payload.modelTypes.includes('image_generation')
}

class OpenAiCompatibleAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload)
    return { ok: true, message: '连接成功' }
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {}
    const firstUrl = joinUrl(payload.apiBaseUrl, '/v1/models')
    try {
      const body = await readJson<OpenAiResponse>(firstUrl, { method: 'GET', headers })
      const ids = (body.data ?? []).map((item) => item.id ?? '').filter(Boolean)
      return toModelItems(ids, 'General')
    } catch (_ignore) {
      const fallbackBody = await readJson<OpenAiResponse>(joinUrl(payload.apiBaseUrl, '/models'), { method: 'GET', headers })
      const ids = (fallbackBody.data ?? []).map((item) => item.id ?? '').filter(Boolean)
      return toModelItems(ids, 'General')
    }
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload)
    const headers: HeaderInitLike = {
      'Content-Type': 'application/json',
      ...(payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {}),
    }

    if (payload.modelTypes.includes('embedding')) {
      const body = await readJson(joinUrl(payload.apiBaseUrl, '/embeddings'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: payload.modelCode,
          input: 'ping',
        }),
      })
      return buildJsonResponse(body)
    }

    if (payload.endpointType === 'openai_response') {
      const body = await readJson(joinUrl(payload.apiBaseUrl, '/responses'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: payload.modelCode,
          input: 'ping',
        }),
      })
      return buildJsonResponse(body)
    }

    const body = await readJson(joinUrl(payload.apiBaseUrl, '/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: payload.modelCode,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    return buildJsonResponse(body)
  }
}

class AzureOpenAiAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload)
    return { ok: true, message: '连接成功' }
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { 'api-key': payload.apiKey } : {}
    const url = joinUrl(payload.apiBaseUrl, '/openai/models?api-version=2024-10-21')
    const body = await readJson<OpenAiResponse>(url, { method: 'GET', headers })
    const ids = (body.data ?? []).map((item) => item.id ?? '').filter(Boolean)
    return toModelItems(ids, 'Azure')
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload)
    const headers: HeaderInitLike = {
      'Content-Type': 'application/json',
      ...(payload.apiKey ? { 'api-key': payload.apiKey } : {}),
    }
    const endpoint = payload.modelTypes.includes('embedding')
      ? `/openai/deployments/${payload.modelCode}/embeddings?api-version=2024-10-21`
      : `/openai/deployments/${payload.modelCode}/chat/completions?api-version=2024-10-21`
    const requestBody = payload.modelTypes.includes('embedding')
      ? { input: 'ping' }
      : {
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }
    const body = await readJson(joinUrl(payload.apiBaseUrl, endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })
    return buildJsonResponse(body)
  }
}

class AnthropicAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload)
    return { ok: true, message: '连接成功' }
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = {
      'anthropic-version': '2023-06-01',
      ...(payload.apiKey ? { 'x-api-key': payload.apiKey } : {}),
    }
    const body = await readJson<AnthropicModelListResponse>(joinUrl(payload.apiBaseUrl, '/v1/models'), {
      method: 'GET',
      headers,
    })
    return (body.data ?? [])
      .map((item) => ({
        modelCode: item.id ?? '',
        displayName: item.display_name ?? item.id ?? '',
        groupName: 'Anthropic',
      }))
      .filter((item) => item.modelCode.length > 0)
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload)
    if (payload.modelTypes.includes('embedding')) {
      throw new HttpException(400, 'Anthropic 端点暂不支持嵌入模型检测')
    }
    const headers: HeaderInitLike = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      ...(payload.apiKey ? { 'x-api-key': payload.apiKey } : {}),
    }
    const body = await readJson(joinUrl(payload.apiBaseUrl, '/v1/messages'), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: payload.modelCode,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    return buildJsonResponse(body)
  }
}

class GeminiAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload)
    return { ok: true, message: '连接成功' }
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { 'x-goog-api-key': payload.apiKey } : {}
    const body = await readJson<{ models?: Array<{ name?: string; displayName?: string }> }>(
      joinUrl(payload.apiBaseUrl, '/v1beta/models'),
      { method: 'GET', headers },
    )
    return (body.models ?? [])
      .map((item) => ({
        modelCode: (item.name ?? '').replace(/^models\//, ''),
        displayName: item.displayName ?? (item.name ?? '').replace(/^models\//, ''),
        groupName: 'Gemini',
      }))
      .filter((item) => item.modelCode.length > 0)
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload)
    const headers: HeaderInitLike = {
      'Content-Type': 'application/json',
      ...(payload.apiKey ? { 'x-goog-api-key': payload.apiKey } : {}),
    }
    const endpoint = payload.modelTypes.includes('embedding')
      ? `/v1beta/models/${payload.modelCode}:embedContent`
      : `/v1beta/models/${payload.modelCode}:generateContent`
    const requestBody = payload.modelTypes.includes('embedding')
      ? {
          content: {
            parts: [{ text: 'ping' }],
          },
        }
      : {
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        }
    const body = await readJson(joinUrl(payload.apiBaseUrl, endpoint), {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    })
    return buildJsonResponse(body)
  }
}

class OllamaAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload)
    return { ok: true, message: '连接成功' }
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const body = await readJson<OllamaResponse>(joinUrl(payload.apiBaseUrl, '/api/tags'), { method: 'GET' })
    const ids = (body.models ?? []).map((item) => item.name ?? '').filter(Boolean)
    return toModelItems(ids, 'Local')
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload)
    if (payload.modelTypes.includes('embedding')) {
      const body = await readJson(joinUrl(payload.apiBaseUrl, '/api/embed'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: payload.modelCode,
          input: 'ping',
        }),
      })
      return buildJsonResponse(body)
    }
    const body = await readJson(joinUrl(payload.apiBaseUrl, '/api/generate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: payload.modelCode,
        prompt: 'ping',
        stream: false,
      }),
    })
    return buildJsonResponse(body)
  }
}

class DashscopeAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload)
    return { ok: true, message: '连接成功' }
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {}
    const body = await readJson<OpenAiResponse>(joinUrl(payload.apiBaseUrl, '/models'), { method: 'GET', headers })
    const ids = (body.data ?? []).map((item) => item.id ?? '').filter(Boolean)
    return toModelItems(ids, 'DashScope')
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload)
    const headers: HeaderInitLike = {
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'disable',
      ...(payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {}),
    }

    if (isDashscopeImageModel(payload)) {
      const body = await readJson(
        joinUrl(payload.apiBaseUrl, '/api/v1/services/aigc/multimodal-generation/generation'),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: payload.modelCode,
            input: {
              prompt: 'ping',
            },
            parameters: {
              size: '1024*1024',
            },
          }),
        },
      )
      return buildJsonResponse(body)
    }

    const openAiAdapter = new OpenAiCompatibleAdapter()
    return openAiAdapter.testModelConnection(payload)
  }
}

export class LlmTypeAdapterService {
  private readonly openaiAdapter = new OpenAiCompatibleAdapter()
  private readonly azureAdapter = new AzureOpenAiAdapter()
  private readonly anthropicAdapter = new AnthropicAdapter()
  private readonly geminiAdapter = new GeminiAdapter()
  private readonly ollamaAdapter = new OllamaAdapter()
  private readonly dashscopeAdapter = new DashscopeAdapter()

  public getAdapter(typeCode: string): LlmTypeAdapter {
    if (
      typeCode === 'openai' ||
      typeCode === 'openai_response' ||
      typeCode === 'new_api' ||
      typeCode === 'openai_image' ||
      typeCode === 'jina_rerank' ||
      typeCode === 'volcengine_ark' ||
      typeCode === 'geekai'
    ) {
      return this.openaiAdapter
    }
    if (typeCode === 'dashscope' || typeCode === 'dashscope_text2image') {
      return this.dashscopeAdapter
    }
    if (typeCode === 'azure_openai') {
      return this.azureAdapter
    }
    if (typeCode === 'anthropic') {
      return this.anthropicAdapter
    }
    if (typeCode === 'gemini') {
      return this.geminiAdapter
    }
    if (typeCode === 'ollama') {
      return this.ollamaAdapter
    }
    throw new HttpException(501, `Provider type "${typeCode}" 暂未实现 test/fetch 适配器`)
  }
}

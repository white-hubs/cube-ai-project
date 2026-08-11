import { HttpException } from "@dangao/bun-server";

import { safeFetchJson } from "../../util/safe-http";
import { type LlmRemoteModelItem } from "../metadata-inference.service";

export interface LlmProviderConnectionPayload {
  typeCode: string;
  apiBaseUrl: string;
  apiKey: string | null;
}

export interface LlmModelConnectionPayload extends LlmProviderConnectionPayload {
  modelCode: string;
  endpointType: string | null;
  modelTypes: string[];
}

export interface LlmTypeAdapter {
  testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }>;
  fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]>;
  testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }>;
}

type FetchInput = string | URL;
type HeaderInitLike = Record<string, string>;
interface RequestInitLike {
  method?: string;
  headers?: HeaderInitLike;
  body?: string;
}

interface OpenAiResponse {
  data?: { id?: string }[];
}

interface AnthropicModelListResponse {
  data?: { id?: string; display_name?: string }[];
}

interface OllamaResponse {
  models?: { name?: string }[];
}

function buildJsonResponse(body: unknown): { ok: boolean; message: string } {
  return {
    message: typeof body === "object" && body !== null ? "检测成功" : "检测成功",
    ok: true,
  };
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/u, "")}`;
}

async function readJson<T>(input: FetchInput, init?: RequestInitLike): Promise<T> {
  return safeFetchJson<T>(input, init);
}

function toModelItems(ids: string[], groupName: string): LlmRemoteModelItem[] {
  return ids
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => ({
      displayName: id,
      groupName,
      modelCode: id,
    }));
}

function ensureSupportedModelDetection(payload: LlmModelConnectionPayload): void {
  if (payload.modelTypes.includes("rerank")) {
    throw new HttpException(400, "重排模型暂不支持检测");
  }
}

function isDashscopeImageModel(payload: LlmModelConnectionPayload): boolean {
  return payload.endpointType === "dashscope_text2image" || payload.modelTypes.includes("image_generation");
}

class OpenAiCompatibleAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload);
    return { message: "连接成功", ok: true };
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {};
    const firstUrl = joinUrl(payload.apiBaseUrl, "/v1/models");
    try {
      const body = await readJson<OpenAiResponse>(firstUrl, { headers, method: "GET" });
      const ids = (body.data ?? []).map((item) => item.id ?? "").filter(Boolean);
      return toModelItems(ids, "General");
    } catch {
      const fallbackBody = await readJson<OpenAiResponse>(joinUrl(payload.apiBaseUrl, "/models"), { headers, method: "GET" });
      const ids = (fallbackBody.data ?? []).map((item) => item.id ?? "").filter(Boolean);
      return toModelItems(ids, "General");
    }
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload);
    const headers: HeaderInitLike = {
      "Content-Type": "application/json",
      ...(payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {}),
    };

    if (payload.modelTypes.includes("embedding")) {
      const body = await readJson(joinUrl(payload.apiBaseUrl, "/embeddings"), {
        body: JSON.stringify({
          model: payload.modelCode,
          input: "ping",
        }),
        headers,
        method: "POST",
      });
      return buildJsonResponse(body);
    }

    if (payload.endpointType === "openai_response") {
      const body = await readJson(joinUrl(payload.apiBaseUrl, "/responses"), {
        body: JSON.stringify({
          model: payload.modelCode,
          input: "ping",
        }),
        headers,
        method: "POST",
      });
      return buildJsonResponse(body);
    }

    const body = await readJson(joinUrl(payload.apiBaseUrl, "/chat/completions"), {
      body: JSON.stringify({
        model: payload.modelCode,
        messages: [{ role: "user", content: "ping" }],
      }),
      headers,
      method: "POST",
    });
    return buildJsonResponse(body);
  }
}

class AzureOpenAiAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload);
    return { message: "连接成功", ok: true };
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { "api-key": payload.apiKey } : {};
    const url = joinUrl(payload.apiBaseUrl, "/openai/models?api-version=2024-10-21");
    const body = await readJson<OpenAiResponse>(url, { headers, method: "GET" });
    const ids = (body.data ?? []).map((item) => item.id ?? "").filter(Boolean);
    return toModelItems(ids, "Azure");
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload);
    const headers: HeaderInitLike = {
      "Content-Type": "application/json",
      ...(payload.apiKey ? { "api-key": payload.apiKey } : {}),
    };
    const endpoint = payload.modelTypes.includes("embedding")
      ? `/openai/deployments/${payload.modelCode}/embeddings?api-version=2024-10-21`
      : `/openai/deployments/${payload.modelCode}/chat/completions?api-version=2024-10-21`;
    const requestBody = payload.modelTypes.includes("embedding")
      ? { input: "ping" }
      : {
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }],
        };
    const body = await readJson(joinUrl(payload.apiBaseUrl, endpoint), {
      body: JSON.stringify(requestBody),
      headers,
      method: "POST",
    });
    return buildJsonResponse(body);
  }
}

class AnthropicAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload);
    return { message: "连接成功", ok: true };
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = {
      "anthropic-version": "2023-06-01",
      ...(payload.apiKey ? { "x-api-key": payload.apiKey } : {}),
    };
    const body = await readJson<AnthropicModelListResponse>(joinUrl(payload.apiBaseUrl, "/v1/models"), {
      headers,
      method: "GET",
    });
    return (body.data ?? [])
      .map((item) => ({
        displayName: item.display_name ?? item.id ?? "",
        groupName: "Anthropic",
        modelCode: item.id ?? "",
      }))
      .filter((item) => item.modelCode.length > 0);
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload);
    if (payload.modelTypes.includes("embedding")) {
      throw new HttpException(400, "Anthropic 端点暂不支持嵌入模型检测");
    }
    const headers: HeaderInitLike = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      ...(payload.apiKey ? { "x-api-key": payload.apiKey } : {}),
    };
    const body = await readJson(joinUrl(payload.apiBaseUrl, "/v1/messages"), {
      body: JSON.stringify({
        model: payload.modelCode,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
      headers,
      method: "POST",
    });
    return buildJsonResponse(body);
  }
}

class GeminiAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload);
    return { message: "连接成功", ok: true };
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { "x-goog-api-key": payload.apiKey } : {};
    const body = await readJson<{ models?: { name?: string; displayName?: string }[] }>(joinUrl(payload.apiBaseUrl, "/v1beta/models"), {
      headers,
      method: "GET",
    });
    return (body.models ?? [])
      .map((item) => ({
        displayName: item.displayName ?? (item.name ?? "").replace(/^models\//u, ""),
        groupName: "Gemini",
        modelCode: (item.name ?? "").replace(/^models\//u, ""),
      }))
      .filter((item) => item.modelCode.length > 0);
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload);
    const headers: HeaderInitLike = {
      "Content-Type": "application/json",
      ...(payload.apiKey ? { "x-goog-api-key": payload.apiKey } : {}),
    };
    const endpoint = payload.modelTypes.includes("embedding")
      ? `/v1beta/models/${payload.modelCode}:embedContent`
      : `/v1beta/models/${payload.modelCode}:generateContent`;
    const requestBody = payload.modelTypes.includes("embedding")
      ? {
          content: {
            parts: [{ text: "ping" }],
          },
        }
      : {
          contents: [{ parts: [{ text: "ping" }], role: "user" }],
        };
    const body = await readJson(joinUrl(payload.apiBaseUrl, endpoint), {
      body: JSON.stringify(requestBody),
      headers,
      method: "POST",
    });
    return buildJsonResponse(body);
  }
}

class OllamaAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload);
    return { message: "连接成功", ok: true };
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const body = await readJson<OllamaResponse>(joinUrl(payload.apiBaseUrl, "/api/tags"), { method: "GET" });
    const ids = (body.models ?? []).map((item) => item.name ?? "").filter(Boolean);
    return toModelItems(ids, "Local");
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload);
    if (payload.modelTypes.includes("embedding")) {
      const body = await readJson(joinUrl(payload.apiBaseUrl, "/api/embed"), {
        body: JSON.stringify({
          model: payload.modelCode,
          input: "ping",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      return buildJsonResponse(body);
    }
    const body = await readJson(joinUrl(payload.apiBaseUrl, "/api/generate"), {
      body: JSON.stringify({
        model: payload.modelCode,
        prompt: "ping",
        stream: false,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    return buildJsonResponse(body);
  }
}

class DashscopeAdapter implements LlmTypeAdapter {
  public async testConnection(payload: LlmProviderConnectionPayload): Promise<{ ok: boolean; message: string }> {
    await this.fetchModels(payload);
    return { message: "连接成功", ok: true };
  }

  public async fetchModels(payload: LlmProviderConnectionPayload): Promise<LlmRemoteModelItem[]> {
    const headers: HeaderInitLike = payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {};
    const body = await readJson<OpenAiResponse>(joinUrl(payload.apiBaseUrl, "/models"), { headers, method: "GET" });
    const ids = (body.data ?? []).map((item) => item.id ?? "").filter(Boolean);
    return toModelItems(ids, "DashScope");
  }

  public async testModelConnection(payload: LlmModelConnectionPayload): Promise<{ ok: boolean; message: string }> {
    ensureSupportedModelDetection(payload);
    const headers: HeaderInitLike = {
      "Content-Type": "application/json",
      "X-DashScope-Async": "disable",
      ...(payload.apiKey ? { Authorization: `Bearer ${payload.apiKey}` } : {}),
    };

    if (isDashscopeImageModel(payload)) {
      const body = await readJson(joinUrl(payload.apiBaseUrl, "/api/v1/services/aigc/multimodal-generation/generation"), {
        body: JSON.stringify({
          model: payload.modelCode,
          input: {
            prompt: "ping",
          },
          parameters: {
            size: "1024*1024",
          },
        }),
        headers,
        method: "POST",
      });
      return buildJsonResponse(body);
    }

    const openAiAdapter = new OpenAiCompatibleAdapter();
    return openAiAdapter.testModelConnection(payload);
  }
}

export class LlmTypeAdapterService {
  private readonly openaiAdapter = new OpenAiCompatibleAdapter();
  private readonly azureAdapter = new AzureOpenAiAdapter();
  private readonly anthropicAdapter = new AnthropicAdapter();
  private readonly geminiAdapter = new GeminiAdapter();
  private readonly ollamaAdapter = new OllamaAdapter();
  private readonly dashscopeAdapter = new DashscopeAdapter();

  public getAdapter(typeCode: string): LlmTypeAdapter {
    if (
      typeCode === "openai" ||
      typeCode === "openai_response" ||
      typeCode === "new_api" ||
      typeCode === "openai_image" ||
      typeCode === "jina_rerank" ||
      typeCode === "openai_rerank" ||
      typeCode === "volcengine_ark" ||
      typeCode === "geekai"
    ) {
      return this.openaiAdapter;
    }
    if (typeCode === "dashscope" || typeCode === "dashscope_text2image") {
      return this.dashscopeAdapter;
    }
    if (typeCode === "azure_openai") {
      return this.azureAdapter;
    }
    if (typeCode === "anthropic") {
      return this.anthropicAdapter;
    }
    if (typeCode === "gemini") {
      return this.geminiAdapter;
    }
    if (typeCode === "ollama") {
      return this.ollamaAdapter;
    }
    throw new HttpException(501, `Provider type "${typeCode}" 暂未实现 test/fetch 适配器`);
  }
}

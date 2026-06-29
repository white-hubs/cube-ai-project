export interface ConnectivityTestResult {
  ok: boolean;
  message: string;
}

export interface LlmConnectivityAdapter {
  readonly endpointType: string;
  testConnection(apiBaseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ConnectivityTestResult>;
  fetchModels?(apiBaseUrl: string, apiKey: string, signal?: AbortSignal): Promise<{ modelCode: string; displayName: string }[]>;
}

type FetchLike = typeof fetch;

function trimBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/+$/u, "");
}

class HttpConnectivityAdapter implements LlmConnectivityAdapter {
  constructor(
    readonly endpointType: string,
    private readonly buildUrl: (base: string) => string,
    private readonly buildHeaders: (apiKey: string) => Record<string, string>,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  async testConnection(apiBaseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ConnectivityTestResult> {
    const url = this.buildUrl(trimBase(apiBaseUrl));
    const response = await this.fetchImpl(url, {
      headers: this.buildHeaders(apiKey),
      signal,
    });
    return response.ok ? { message: "reachable", ok: true } : { message: `HTTP ${response.status}`, ok: false };
  }
}

export class OpenAiCompatibleConnectivityAdapter implements LlmConnectivityAdapter {
  readonly endpointType = "openai";

  constructor(private readonly fetchImpl: FetchLike = globalThis.fetch) {}

  async testConnection(apiBaseUrl: string, apiKey: string, signal?: AbortSignal): Promise<ConnectivityTestResult> {
    const url = `${trimBase(apiBaseUrl)}/models`;
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    return response.ok ? { message: "models listed", ok: true } : { message: `HTTP ${response.status}`, ok: false };
  }

  async fetchModels(apiBaseUrl: string, apiKey: string, signal?: AbortSignal) {
    const url = `${trimBase(apiBaseUrl)}/models`;
    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      return [];
    }
    const body = (await response.json()) as { data?: { id?: string }[] };
    return (body.data ?? []).map((row) => ({
      displayName: row.id ?? "unknown",
      modelCode: row.id ?? "unknown",
    }));
  }
}

export function createDefaultConnectivityAdapters(fetchImpl: FetchLike = globalThis.fetch): LlmConnectivityAdapter[] {
  return [
    new OpenAiCompatibleConnectivityAdapter(fetchImpl),
    new HttpConnectivityAdapter(
      "anthropic",
      (base) => `${base}/v1/models`,
      (apiKey) => ({ "anthropic-version": "2023-06-01", "x-api-key": apiKey }),
      fetchImpl,
    ),
    new HttpConnectivityAdapter(
      "gemini",
      (base) => `${base}/v1beta/models`,
      (apiKey) => ({ "x-goog-api-key": apiKey }),
      fetchImpl,
    ),
    new HttpConnectivityAdapter(
      "azure_openai",
      (base) => `${base}/openai/models?api-version=2024-02-01`,
      (apiKey) => ({ "api-key": apiKey }),
      fetchImpl,
    ),
    new HttpConnectivityAdapter(
      "ollama",
      (base) => `${base}/api/tags`,
      () => ({}),
      fetchImpl,
    ),
    new HttpConnectivityAdapter(
      "dashscope",
      (base) => `${base}/compatible-mode/v1/models`,
      (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
      fetchImpl,
    ),
  ];
}

export const DEFAULT_CONNECTIVITY_ADAPTERS = createDefaultConnectivityAdapters();

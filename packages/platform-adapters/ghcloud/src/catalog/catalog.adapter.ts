import { LRUCache } from 'lru-cache';
import {
  LlmModelRuntimeConfigSchema,
  LlmProviderSummarySchema,
  type LlmCatalogPort,
  type LlmModelRuntimeConfig,
  type LlmProviderSummary,
} from '@cube-ai/contracts';
import { GhcloudPlatformError } from '../errors';
import { doFetchJson } from '../fetch-utils';

const NULL_RUNTIME = Symbol('null-runtime');
type CachedRuntime = LlmModelRuntimeConfig | typeof NULL_RUNTIME;

export interface GhcloudLlmCatalogAdapterOpts {
  baseUrl: string;
  tokenProvider: (tenant: number) => Promise<string>;
  timeoutMs?: number;
  cacheTtlMs?: number;
  cacheMax?: number;
  fetchImpl?: typeof fetch;
}

export class GhcloudLlmCatalogAdapter implements LlmCatalogPort {
  private readonly cache: LRUCache<string, CachedRuntime>;

  constructor(private readonly opts: GhcloudLlmCatalogAdapterOpts) {
    this.cache = new LRUCache<string, CachedRuntime>({
      max: opts.cacheMax ?? 1024,
      ttl: opts.cacheTtlMs ?? 60_000,
    });
  }

  async listProviders(tenant: number, signal: AbortSignal): Promise<LlmProviderSummary[]> {
    const token = await this.opts.tokenProvider(tenant);
    const { body } = await doFetchJson({
      url: `${this.opts.baseUrl}/ai/llm/providers`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        tenant: String(tenant),
        terminal: 'bimops-manage-web',
        'X-Engine-Caller': 'cube-agentic-engine',
      },
      signal,
      timeoutMs: this.opts.timeoutMs ?? 10_000,
      fetchImpl: this.opts.fetchImpl,
    });
    if (!Array.isArray(body)) {
      throw GhcloudPlatformError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'llm catalog providers remote response did not match schema',
        { body },
      );
    }
    return body.map((row) =>
      LlmProviderSummarySchema.parse({
        id: expectProviderIdField(row, 'id'),
        providerCode: expectStringField(row, 'providerCode'),
        typeCode: expectStringField(row, 'typeCode'),
        /** 列表行上的 base URL 不参与实际 chat（见 `resolveModelRuntime`）；中台常漏填或为 null。 */
        apiBaseUrl: apiBaseUrlFromProviderListRow(row),
        enabled: expectBooleanField(row, 'enabled'),
      }),
    );
  }

  async resolveModelRuntime(
    tenant: number,
    modelCode: string,
    signal: AbortSignal,
  ): Promise<LlmModelRuntimeConfig | null> {
    const key = `${tenant}:${modelCode}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached === NULL_RUNTIME ? null : cached;
    }
    const token = await this.opts.tokenProvider(tenant);
    const headers = {
      Authorization: `Bearer ${token}`,
      tenant: String(tenant),
      terminal: 'bimops-manage-web',
      'X-Engine-Caller': 'cube-agentic-engine',
    } as const;
    const providers = await this.listProviders(tenant, signal);
    const enabled = providers.filter((p) => p.enabled);
    if (enabled.length === 0) {
      this.cache.set(key, NULL_RUNTIME);
      return null;
    }
    for (const provider of enabled) {
      try {
        const { body } = await doFetchJson({
          url: `${this.opts.baseUrl}/ai/llm/providers/${encodeURIComponent(provider.id)}/models/${encodeURIComponent(modelCode)}/runtime-config`,
          method: 'GET',
          headers: { ...headers },
          signal,
          timeoutMs: this.opts.timeoutMs ?? 10_000,
          fetchImpl: this.opts.fetchImpl,
        });
        const parsed = LlmModelRuntimeConfigSchema.safeParse(body);
        if (!parsed.success) {
          throw GhcloudPlatformError.fromCode(
            'INVALID_ARGUMENT_SCHEMA_VIOLATION',
            'llm catalog runtime-config remote response did not match schema',
            { issues: parsed.error.issues },
          );
        }
        this.cache.set(key, parsed.data);
        return parsed.data;
      } catch (e) {
        if (e instanceof GhcloudPlatformError && e.code === 'RESOURCE_NOT_FOUND_REMOTE') {
          continue;
        }
        throw e;
      }
    }
    this.cache.set(key, NULL_RUNTIME);
    return null;
  }

  invalidate(tenant: number, modelCode?: string): void {
    if (modelCode) {
      this.cache.delete(`${tenant}:${modelCode}`);
      return;
    }
    for (const k of this.cache.keys()) {
      if (k.startsWith(`${tenant}:`)) this.cache.delete(k);
    }
  }
}

function expectProviderIdField(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `llm catalog providers response missing ${field}`,
      { value },
    );
  }
  const candidate = (value as Record<string, unknown>)[field];
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }
  if (typeof candidate === 'number' && Number.isFinite(candidate)) {
    return String(candidate);
  }
  throw GhcloudPlatformError.fromCode(
    'INVALID_ARGUMENT_SCHEMA_VIOLATION',
    `llm catalog providers response field ${field} is not a non-empty id`,
    { value },
  );
}

/**
 * `GET /ai/llm/providers` 单行里用于「发现 provider id」；真实 endpoint/apiKey 来自
 * `.../runtime-config`。中台 DTO 可能 `apiBaseUrl: null` 或只用 `baseUrl` 等别名，
 * 此处做宽松解析；全无则保持 null，表示供应商连接尚未配置。
 */
function apiBaseUrlFromProviderListRow(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'llm catalog providers row is not object',
      { value: row },
    );
  }
  const r = row as Record<string, unknown>;
  const keys = ['apiBaseUrl', 'baseUrl', 'apiUrl', 'endpoint', 'hostUrl'] as const;
  for (const k of keys) {
    const v = r[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t.length > 0) return t;
    }
  }
  return null;
}

function expectStringField(value: unknown, field: string): string {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `llm catalog providers response missing ${field}`,
      { value },
    );
  }
  const candidate = (value as Record<string, unknown>)[field];
  if (typeof candidate !== 'string') {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `llm catalog providers response field ${field} is not string`,
      { value },
    );
  }
  return candidate;
}

function expectBooleanField(value: unknown, field: string): boolean {
  if (typeof value !== 'object' || value === null || !(field in value)) {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `llm catalog providers response missing ${field}`,
      { value },
    );
  }
  const candidate = (value as Record<string, unknown>)[field];
  if (typeof candidate !== 'boolean') {
    throw GhcloudPlatformError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `llm catalog providers response field ${field} is not boolean`,
      { value },
    );
  }
  return candidate;
}

import { HEADER_AGENTIC_CAPABILITY, HEADER_TRACE_ID } from "@cube-ai/contracts";

import { AgenticClientError } from "./errors";
import { FilesApi } from "./files";
import { GrantsApi } from "./grants";
import { JobsApi } from "./jobs";
import { SessionApi } from "./session";
import { DescriptorsApi, ToolAcksApi, ToolsApi } from "./tools";
import { buildVersionHeaders } from "./versioning";

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildTraceparent(): string {
  return `00-${randomHex(16)}-${randomHex(8)}-01`;
}

export interface AgenticClientConfig {
  /** Engine base URL (no trailing slash). */
  baseUrl: string;
  /** Bearer token provider. */
  auth?: {
    provider: () => Promise<string> | string;
    onUnauthorized?: () => Promise<string | null>;
  };
  /**
   * Per-request 动态身份/上下文 header（如 multi-tenant 的 `tenant` / `terminal`）。
   * 合并顺序：framework headers → auth (`authorization`) → headersProvider → caller `extra`。
   * 与 `auth` 平行：`auth` 表达"凭证"，`headersProvider` 表达"上下文标识"。
   *
   * 注意：returned key 应是**全小写**（与 SDK 默认产出一致；RFC 7230 case-insensitive）。
   *
   * Ref: ADR-0008 §D2
   */
  headersProvider?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Optional capability tags. */
  capabilities?: string[];
  /** Retry config. */
  retry?: { maxAttempts: number; baseDelayMs: number };
  /** SSE reconnect config. */
  sse?: { reconnect: boolean; maxReconnectAttempts: number };
  /** Global fetch implementation override (Bun / Node / Worker). */
  fetchImpl?: typeof fetch;
}

/** @deprecated Use AgenticClientConfig instead */
export type AgenticClientOptions = AgenticClientConfig & {
  token?: string;
  protocolVersion?: string;
};

/**
 * Factory that creates a typed AgenticClient.
 *
 * Accepts both the canonical `AgenticClientConfig` (auth.provider) and the
 * deprecated `AgenticClientOptions` (with `token`/`protocolVersion`) for
 * backwards-compatible test setup.
 *
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §2.1 / design doc §3.2
 */
export function createAgenticClient(config: AgenticClientConfig | AgenticClientOptions): AgenticClient {
  return new AgenticClient(config);
}

/**
 * Main client class. Namespace sub-APIs: sessions, grants, toolAcks, descriptors, tools, jobs.
 * Ref: sdk-core.md §2
 */
export class AgenticClient {
  readonly sessions: SessionApi;
  readonly files: FilesApi;
  readonly grants: GrantsApi;
  readonly toolAcks: ToolAcksApi;
  readonly descriptors: DescriptorsApi;
  readonly tools: ToolsApi;
  readonly jobs: JobsApi;

  private readonly config: AgenticClientConfig;
  readonly fetchImpl: typeof fetch;

  constructor(options: AgenticClientOptions | AgenticClientConfig) {
    const config = options as AgenticClientConfig;
    this.config = {
      ...config,
      baseUrl: config.baseUrl.replace(/\/+$/u, ""),
    };
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);

    this.grants = new GrantsApi(this.config, this);
    this.toolAcks = new ToolAcksApi(this.config, this);
    this.descriptors = new DescriptorsApi(this.config, this);
    this.tools = new ToolsApi(this.config, this);
    this.jobs = new JobsApi(this.config, this);
    this.sessions = new SessionApi(this.config, this);
    this.files = new FilesApi(this.config, this);
  }

  async healthLive(): Promise<{ status: string; timestamp: number }> {
    const response = await this.fetchImpl(`${this.config.baseUrl}/health/live`, {
      headers: await this.buildRequestHeaders(),
      method: "GET",
    });
    if (!response.ok) {
      throw await AgenticClientError.fromResponse(response);
    }
    return (await response.json()) as { status: string; timestamp: number };
  }

  /**
   * Build outgoing headers (全小写 key — RFC 7230 / ghcloud parity)：
   *   framework (versioning + traceparent) → auth → headersProvider → caller extra
   * Ref: sdk-core.md §4.5 / §10 / ADR-0008 §D2
   */
  async buildRequestHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const opts = this.config as AgenticClientOptions;
    const headers: Record<string, string> = {
      accept: "application/json",
      ...buildVersionHeaders(),
      traceparent: buildTraceparent(),
    };

    if (this.config.auth) {
      const token = await Promise.resolve(this.config.auth.provider());
      headers.authorization = `Bearer ${token}`;
    } else if (opts.token) {
      headers.authorization = `Bearer ${opts.token}`;
    }

    if (opts.capabilities?.length) {
      // contracts 历史常量是 `X-Agentic-Capability`；小写化以保持一致风格。
      headers[HEADER_AGENTIC_CAPABILITY.toLowerCase()] = opts.capabilities.join(",");
    }

    if (this.config.headersProvider) {
      const provided = await Promise.resolve(this.config.headersProvider());
      for (const [k, v] of Object.entries(provided)) {
        headers[k.toLowerCase()] = v;
      }
    }

    // caller extra 同样小写化覆盖
    for (const [k, v] of Object.entries(extra)) {
      headers[k.toLowerCase()] = v;
    }

    return headers;
  }

  /**
   * Typed JSON request with intercept order: auth → telemetry → versioning (via buildRequestHeaders),
   * optional retry (network / 503), 401 → onUnauthorized → single replay.
   */
  async requestJson<T>(input: {
    method: "GET" | "POST" | "DELETE" | "PATCH";
    path: string;
    body?: unknown;
    query?: Record<string, string | number | boolean | undefined>;
    signal?: AbortSignal;
    idempotencyKey?: string;
  }): Promise<T> {
    const url = this.buildUrl(input.path, input.query);

    const baseHeaders = await this.buildRequestHeaders({
      ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
      ...(input.body !== undefined && input.method !== "GET" ? { "content-type": "application/json" } : {}),
    });

    const exec = async (headers: Record<string, string>): Promise<Response> => {
      const init: RequestInit = { headers, method: input.method };
      if (input.body !== undefined && input.method !== "GET") {
        init.body = JSON.stringify(input.body);
      }
      if (input.signal) {
        init.signal = input.signal;
      }
      return this.fetchWithRetry(url, init);
    };

    let resp = await exec(baseHeaders);

    if (resp.status === 401 && this.config.auth?.onUnauthorized) {
      const fresh = await this.config.auth.onUnauthorized();
      if (fresh) {
        const retryHeaders = await this.buildRequestHeaders({
          ...(input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}),
          ...(input.body !== undefined && input.method !== "GET" ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${fresh}`,
        });
        resp = await exec(retryHeaders);
      }
    }

    if (!resp.ok) {
      throw await AgenticClientError.fromResponse(resp);
    }
    if (resp.status === 204) {
      return undefined as T;
    }
    return (await resp.json()) as T;
  }

  protected withIdempotencyKey(key: string): Record<string, string> {
    return { "idempotency-key": key };
  }

  protected withTraceId(traceId: string): Record<string, string> {
    return { [HEADER_TRACE_ID.toLowerCase()]: traceId };
  }

  /**
   * 把 `baseUrl` 当作**字符串前缀**拼接（保留 base 自带的 path 段，如
   * `https://gateway.example.com/api/agentic-engine`）。**不**用 `new URL(path, base)`
   * 的语义——后者把 `path` 当作绝对路径会丢掉 base 的 path 段。
   */
  private buildUrl(path: string, query?: Record<string, string | number | boolean | undefined>): string {
    const base = this.config.baseUrl.replace(/\/+$/u, "");
    const p = path.startsWith("/") ? path : `/${path}`;
    const stem = `${base}${p}`;
    if (!query) {
      return stem;
    }
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined) {
        continue;
      }
      usp.set(k, String(v));
    }
    const qs = usp.toString();
    if (qs === "") {
      return stem;
    }
    return stem.includes("?") ? `${stem}&${qs}` : `${stem}?${qs}`;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    const max = this.config.retry?.maxAttempts ?? 3;
    const baseD = this.config.retry?.baseDelayMs ?? 500;
    let last: Error | undefined;
    for (let attempt = 1; attempt <= max; attempt++) {
      try {
        const resp = await this.fetchImpl(url, init);
        if (resp.status === 503) {
          const ra = resp.headers.get("Retry-After");
          if (ra && attempt < max) {
            const sec = Number.parseInt(ra, 10);
            await this.sleep(Number.isFinite(sec) ? Math.min(sec * 1000, 10_000) : baseD * 2 ** (attempt - 1));
            continue;
          }
        }
        return resp;
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        last = error;
        if (attempt === max) {
          throw new AgenticClientError(null, null, error.message, null, null, Date.now(), error);
        }
        await this.sleep(baseD * 2 ** (attempt - 1) + Math.random() * 200);
      }
    }
    throw new AgenticClientError(null, null, last?.message ?? "Request failed after retries", null, null, Date.now(), last);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}

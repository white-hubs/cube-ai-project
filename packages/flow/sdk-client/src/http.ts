export interface FlowSdkConfig {
  baseUrl: string;
  pathPrefix?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

export async function flowRequestJson<T>(config: FlowSdkConfig, method: string, path: string, body?: unknown): Promise<T> {
  const prefix = config.pathPrefix ?? "/flow";
  const url = `${config.baseUrl.replace(/\/$/u, "")}${prefix}${path}`;
  const extra = typeof config.headers === "function" ? await config.headers() : (config.headers ?? {});
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      accept: "application/json",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...extra,
    },
    method,
  });
  if (!res.ok) {
    throw new Error(`flow-sdk-client ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function resolveUrl(config: FlowSdkConfig, path: string): string {
  const prefix = config.pathPrefix ?? "/flow";
  return `${config.baseUrl.replace(/\/$/u, "")}${prefix}${path}`;
}

async function resolveHeaders(config: FlowSdkConfig): Promise<Record<string, string>> {
  return typeof config.headers === "function" ? await config.headers() : (config.headers ?? {});
}

/** Raw request returning the {@link Response} unread — used for SSE / streaming endpoints (run-stream). */
export async function flowRequestRaw(config: FlowSdkConfig, method: string, path: string, body?: unknown): Promise<Response> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(resolveUrl(config, path), {
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      accept: "text/event-stream",
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(await resolveHeaders(config)),
    },
    method,
  });
  if (!res.ok) {
    throw new Error(`flow-sdk-client ${method} ${path}: HTTP ${res.status}`);
  }
  return res;
}

/** Multipart upload (FormData) — used for flow file uploads. Content-Type set by the runtime. */
export async function flowRequestMultipart<T>(config: FlowSdkConfig, path: string, form: FormData): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(resolveUrl(config, path), {
    body: form,
    headers: {
      accept: "application/json",
      ...(await resolveHeaders(config)),
    },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`flow-sdk-client POST ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

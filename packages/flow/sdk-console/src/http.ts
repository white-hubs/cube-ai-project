export interface FlowConsoleConfig {
  baseUrl: string;
  pathPrefix?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

export async function flowConsoleRequestJson<T>(
  config: FlowConsoleConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const prefix = config.pathPrefix ?? '/flow/console';
  const url = `${config.baseUrl.replace(/\/$/, '')}${prefix}${path}`;
  const extra =
    typeof config.headers === 'function' ? await config.headers() : (config.headers ?? {});
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(url, {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`flow-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface KbConsoleConfig {
  baseUrl: string;
  pathPrefix?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

export async function kbConsoleRequestJson<T>(config: KbConsoleConfig, method: string, path: string, body?: unknown): Promise<T> {
  const prefix = config.pathPrefix ?? "/kb/console";
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
    throw new Error(`kb-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

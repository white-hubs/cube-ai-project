export interface LlmConsoleConfig {
  baseUrl: string;
  pathPrefix?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

function resolveLlmConsoleUrl(config: LlmConsoleConfig, path: string): string {
  const baseUrl = config.baseUrl.replace(/\/$/u, "");
  const rawPrefix = config.pathPrefix;
  const prefix = rawPrefix ?? "/llm/console";

  if (
    baseUrl.endsWith("/llm") &&
    (rawPrefix === undefined ||
      rawPrefix === "" ||
      rawPrefix === "/llm" ||
      rawPrefix === "/llm/" ||
      rawPrefix === "/llm/console" ||
      rawPrefix === "/llm/console/")
  ) {
    return `${baseUrl}/console${path}`;
  }

  if (prefix === "/llm" || prefix === "/llm/") {
    return `${baseUrl}/llm/console${path}`;
  }

  return `${baseUrl}${prefix.replace(/\/$/u, "")}${path}`;
}

export async function llmConsoleRequestJson<T>(config: LlmConsoleConfig, method: string, path: string, body?: unknown): Promise<T> {
  const url = resolveLlmConsoleUrl(config, path);
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
    throw new Error(`llm-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

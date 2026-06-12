export interface AgentConsoleConfig {
  baseUrl: string;
  pathPrefix?: string;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
}

const DEFAULT_PATH_PREFIX = '/agent';

async function resolveExtraHeaders(config: AgentConsoleConfig): Promise<Record<string, string>> {
  return typeof config.headers === 'function' ? await config.headers() : (config.headers ?? {});
}

function buildUrl(config: AgentConsoleConfig, path: string): string {
  const prefix = config.pathPrefix ?? DEFAULT_PATH_PREFIX;
  return `${config.baseUrl.replace(/\/$/, '')}${prefix}${path}`;
}

/**
 * JSON request helper. Sends `content-type: application/json` and JSON.stringify's the body
 * when one is provided. Returns the parsed JSON response.
 */
export async function agentConsoleRequestJson<T>(
  config: AgentConsoleConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(buildUrl(config, path), {
    method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(await resolveExtraHeaders(config)),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`agent-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/**
 * text/plain request helper. Sends the raw string body verbatim (NOT JSON.stringify'd) with
 * `content-type: text/plain`. Used by the `:fromDocument` endpoints. Returns parsed JSON.
 */
export async function agentConsoleRequestText<T>(
  config: AgentConsoleConfig,
  method: string,
  path: string,
  body: string,
): Promise<T> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(buildUrl(config, path), {
    method,
    headers: {
      accept: 'application/json',
      'content-type': 'text/plain',
      ...(await resolveExtraHeaders(config)),
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`agent-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

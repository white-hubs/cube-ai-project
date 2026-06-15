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

/** One parsed Server-Sent Event record (`event:` line + concatenated `data:` lines). */
export interface AgentConsoleSseEvent {
  event: string;
  data: string;
}

function parseSseBlock(block: string): AgentConsoleSseEvent | null {
  let event = 'message';
  let data = '';
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trimStart();
    else if (line.startsWith('data:')) data += line.slice(5).trimStart();
  }
  return data ? { event, data } : null;
}

/**
 * SSE request helper. POSTs a JSON body and consumes a `text/event-stream` response,
 * invoking `onEvent` for each parsed record (incrementally when the body is a stream).
 * Used by `:propose` (ADR-0027 §5). Returns once the stream ends.
 */
export async function agentConsoleStreamSse(
  config: AgentConsoleConfig,
  method: string,
  path: string,
  body: unknown,
  onEvent: (event: AgentConsoleSseEvent) => void,
): Promise<void> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const res = await fetchImpl(buildUrl(config, path), {
    method,
    headers: {
      accept: 'text/event-stream',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(await resolveExtraHeaders(config)),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`agent-sdk-console ${method} ${path}: HTTP ${res.status}`);
  }

  const emitBlocks = (chunk: string): void => {
    let idx: number;
    while ((idx = chunk.indexOf('\n\n')) >= 0) {
      const block = chunk.slice(0, idx);
      chunk = chunk.slice(idx + 2);
      const ev = parseSseBlock(block);
      if (ev) onEvent(ev);
    }
    buffer = chunk;
  };

  let buffer = '';
  const reader = res.body?.getReader();
  if (!reader) {
    // No stream (e.g. mocked string body): parse the whole text at once.
    buffer = await res.text();
  } else {
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      emitBlocks(buffer + decoder.decode(value, { stream: true }));
    }
  }
  // Flush any trailing block (stream may end without a final blank line).
  for (const block of buffer.split('\n\n')) {
    const ev = parseSseBlock(block);
    if (ev) onEvent(ev);
  }
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

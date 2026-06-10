import { GhcloudPlatformError } from './errors';

export interface DoFetchJsonOptions {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  bodyJson?: unknown;
  signal: AbortSignal;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export interface DoFetchJsonResult {
  status: number;
  body: unknown;
}

/**
 * fetch + JSON wrapper that:
 *   - Composes caller AbortSignal with a per-call timeout.
 *   - Maps non-2xx + network errors to GhcloudPlatformError with stable codes.
 *   - Always parses JSON; non-JSON 5xx becomes UPSTREAM_TOOL_HTTP_FAILED.
 */
export async function doFetchJson(opts: DoFetchJsonOptions): Promise<DoFetchJsonResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  opts.signal.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs);

  try {
    const resp = await fetchImpl(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.bodyJson === undefined ? undefined : JSON.stringify(opts.bodyJson),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }

    if (resp.status === 401 || resp.status === 403) {
      throw GhcloudPlatformError.fromCode(
        'UPSTREAM_AUTH_FAILED',
        `${opts.method} ${opts.url} -> HTTP ${resp.status}`,
        { status: resp.status, body: parsed },
      );
    }
    if (resp.status === 404) {
      throw GhcloudPlatformError.fromCode(
        'RESOURCE_NOT_FOUND_REMOTE',
        `${opts.method} ${opts.url} -> HTTP 404`,
        { status: 404, body: parsed },
      );
    }
    if (!resp.ok) {
      throw GhcloudPlatformError.fromCode(
        'UPSTREAM_TOOL_HTTP_FAILED',
        `${opts.method} ${opts.url} -> HTTP ${resp.status}`,
        { status: resp.status, body: parsed },
      );
    }
    return { status: resp.status, body: parsed };
  } catch (e) {
    if (e instanceof GhcloudPlatformError) throw e;
    if (e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message))) {
      throw GhcloudPlatformError.fromCode(
        'UPSTREAM_NETWORK_TIMEOUT',
        `${opts.method} ${opts.url} timed out after ${opts.timeoutMs}ms`,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw GhcloudPlatformError.fromCode(
      'UPSTREAM_TOOL_HTTP_FAILED',
      `${opts.method} ${opts.url} failed: ${msg}`,
    );
  } finally {
    clearTimeout(timer);
    opts.signal.removeEventListener('abort', onAbort);
  }
}

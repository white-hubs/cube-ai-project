/**
 * HttpHandler — 使用 fetch 的 HTTP 调用（超时、重试、状态码映射）。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md §2
 */
import { Injectable } from '@dangao/bun-server';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

export interface HttpHandlerInput {
  url:      string;
  method:   'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?:    unknown;
  query?:   Record<string, string>;
}

export interface HttpHandlerOutput {
  statusCode: number;
  body:       unknown;
  headers?:   Record<string, string>;
}

const BLOCKED_RESPONSE_HEADERS = new Set([
  'set-cookie',
  'content-disposition',
  'www-authenticate',
  'proxy-authenticate',
  'authorization',
]);

function buildUrlWithQuery(
  base: string,
  query?: Record<string, string>,
): string {
  if (!query || Object.keys(query).length === 0) return base;
  const u = new URL(base);
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  return u.toString();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function parseBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  return JSON.stringify(body);
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

@Injectable()
export class HttpHandler implements ToolHandler<HttpHandlerInput, HttpHandlerOutput> {
  readonly kind = 'http' as const;

  async invoke(input: HttpHandlerInput, ctx: ToolHandlerCtx): Promise<HttpHandlerOutput> {
    const timeoutMs = Number(process.env['AGENTIC_ENGINE_HTTP_TIMEOUT_MS'] ?? '30000');
    const maxAttempts = Math.min(
      8,
      Math.max(1, Number(process.env['AGENTIC_ENGINE_HTTP_RETRY_MAX'] ?? '3')),
    );
    const baseBackoffMs = Number(process.env['AGENTIC_ENGINE_HTTP_RETRY_BACKOFF_MS'] ?? '200');

    let url: string;
    try {
      url = buildUrlWithQuery(input.url, input.query);
      // eslint-disable-next-line no-new -- validate URL
      new URL(url);
    } catch {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'HttpHandler: invalid url / query combination',
      );
    }

    const headers = new Headers(input.headers ?? {});
    const bodyInit = parseBody(input.body);
    if (bodyInit !== undefined && !headers.has('content-type')) {
      headers.set('Content-Type', 'application/json');
    }

    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (ctx.signal.aborted) {
        throw AgenticEngineError.fromCode(
          'UPSTREAM_TOOL_HTTP_FAILED',
          'HttpHandler: aborted before request (parent signal)',
        );
      }

      const ctrl = new AbortController();
      const onParentAbort = () => ctrl.abort();
      ctx.signal.addEventListener('abort', onParentAbort);
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      try {
        const resp = await fetch(url, {
          method:  input.method,
          headers,
          body:    ['GET', 'HEAD'].includes(input.method) ? undefined : bodyInit,
          signal:  ctrl.signal,
        });

        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onParentAbort);

        const rawText = await resp.text();
        const parsedBody =
          resp.headers.get('content-type')?.includes('application/json')
            ? safeJsonParse(rawText)
            : rawText;

        const outHeaders: Record<string, string> = {};
        resp.headers.forEach((v, k) => {
          if (!BLOCKED_RESPONSE_HEADERS.has(k.toLowerCase())) {
            outHeaders[k] = v;
          }
        });

        if (resp.status >= 500 || resp.status === 429) {
          lastErr = AgenticEngineError.fromCode(
            'UPSTREAM_TOOL_HTTP_FAILED',
            `HttpHandler: upstream HTTP ${resp.status}`,
            { httpStatus: resp.status, attempt },
          );
          if (attempt < maxAttempts) {
            await sleep(baseBackoffMs * 2 ** (attempt - 1));
            continue;
          }
          throw lastErr;
        }

        return {
          statusCode: resp.status,
          body:       parsedBody,
          headers:    outHeaders,
        };
      } catch (e) {
        clearTimeout(timer);
        ctx.signal.removeEventListener('abort', onParentAbort);
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const isAbort =
          e instanceof Error &&
          (e.name === 'AbortError' || msg.includes('abort'));
        if (isAbort) {
          throw AgenticEngineError.fromCode(
            'UPSTREAM_NETWORK_TIMEOUT',
            `HttpHandler: timeout after ${timeoutMs}ms`,
            { url },
          );
        }
        if (attempt >= maxAttempts) break;
        await sleep(baseBackoffMs * 2 ** (attempt - 1));
      }
    }

    throw AgenticEngineError.fromCode(
      'UPSTREAM_TOOL_HTTP_FAILED',
      `HttpHandler: fetch failed after ${maxAttempts} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    );
  }
}

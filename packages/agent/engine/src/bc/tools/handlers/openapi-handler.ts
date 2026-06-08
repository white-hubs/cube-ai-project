/**
 * OpenApiHandler — 拉取 OpenAPI 文档，按 operationId 路由并用 openapi-fetch 调用。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md
 */
import { Injectable } from '@dangao/bun-server';
import createClient from 'openapi-fetch';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

export interface OpenApiHandlerInput {
  specUrl:     string;
  operationId: string;
  params?:     Record<string, unknown>;
  body?:       unknown;
}

export interface OpenApiHandlerOutput {
  statusCode: number;
  body:       unknown;
}

interface OasPathItem {
  get?:    { operationId?: string };
  put?:    { operationId?: string };
  post?:   { operationId?: string };
  patch?:  { operationId?: string };
  delete?: { operationId?: string };
}

interface OasDoc {
  servers?: { url: string }[];
  paths:    Record<string, OasPathItem>;
}

type Method = 'get' | 'put' | 'post' | 'patch' | 'delete';

function findOperation(
  doc: OasDoc,
  operationId: string,
): { method: Method; pathTemplate: string } | null {
  for (const [pathTemplate, item] of Object.entries(doc.paths ?? {})) {
    const methods: Method[] = ['get', 'put', 'post', 'patch', 'delete'];
    for (const m of methods) {
      const op = item[m];
      if (op?.operationId === operationId) return { method: m, pathTemplate };
    }
  }
  return null;
}

function pathKeys(template: string): string[] {
  const keys: string[] = [];
  for (const m of template.matchAll(/\{([^}]+)\}/g)) {
    keys.push(m[1] ?? '');
  }
  return keys;
}

/** 宽松 Paths：运行时由远端 spec 决定 */
type LoosePaths = Record<string, Record<string, unknown>>;

@Injectable()
export class OpenApiHandler implements ToolHandler<OpenApiHandlerInput, OpenApiHandlerOutput> {
  readonly kind = 'openapi' as const;

  async invoke(input: OpenApiHandlerInput, ctx: ToolHandlerCtx): Promise<OpenApiHandlerOutput> {
    const specResp = await fetch(input.specUrl, { signal: ctx.signal });
    if (!specResp.ok) {
      throw AgenticEngineError.fromCode(
        'UPSTREAM_OPENAPI_SPEC_FETCH_FAILED',
        `OpenApiHandler: cannot fetch spec HTTP ${specResp.status}`,
      );
    }
    const doc = (await specResp.json()) as OasDoc;
    const resolved = findOperation(doc, input.operationId);
    if (!resolved) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `OpenApiHandler: operationId '${input.operationId}' not found in spec`,
      );
    }

    const serverUrl =
      doc.servers?.[0]?.url ??
      new URL('.', input.specUrl.endsWith('/') ? input.specUrl : `${input.specUrl}/`).href;

    const pIn = input.params ?? {};
    const pathParams: Record<string, unknown> = {};
    for (const k of pathKeys(resolved.pathTemplate)) {
      if (pIn[k] === undefined || pIn[k] === null) {
        throw AgenticEngineError.fromCode(
          'INVALID_ARGUMENT_SCHEMA_VIOLATION',
          `OpenApiHandler: missing path param '${k}'`,
        );
      }
      pathParams[k] = pIn[k];
    }

    const query: Record<string, unknown> = { ...pIn };
    for (const k of Object.keys(pathParams)) {
      delete query[k];
    }

    const pathArg = resolved.pathTemplate;
    const baseInit = {
      params: {
        path:  pathParams as never,
        query: query as never,
      },
      signal: ctx.signal,
    };

    const client = createClient<LoosePaths>({ baseUrl: serverUrl });
    const c = client as unknown as {
      GET: (
        p: string,
        init: object,
      ) => Promise<{ response: Response; data?: unknown }>;
      POST: (
        p: string,
        init: object,
      ) => Promise<{ response: Response; data?: unknown }>;
      PUT: (
        p: string,
        init: object,
      ) => Promise<{ response: Response; data?: unknown }>;
      PATCH: (
        p: string,
        init: object,
      ) => Promise<{ response: Response; data?: unknown }>;
      DELETE: (
        p: string,
        init: object,
      ) => Promise<{ response: Response; data?: unknown }>;
    };

    try {
      switch (resolved.method) {
        case 'get': {
          const r = await c.GET(pathArg, baseInit);
          return {
            statusCode: r.response.status,
            body:       r.data ?? (await r.response.text()),
          };
        }
        case 'post': {
          const r = await c.POST(pathArg, {
            ...baseInit,
            body: input.body as never,
          });
          return {
            statusCode: r.response.status,
            body:       r.data ?? (await r.response.text()),
          };
        }
        case 'put': {
          const r = await c.PUT(pathArg, {
            ...baseInit,
            body: input.body as never,
          });
          return {
            statusCode: r.response.status,
            body:       r.data ?? (await r.response.text()),
          };
        }
        case 'patch': {
          const r = await c.PATCH(pathArg, {
            ...baseInit,
            body: input.body as never,
          });
          return {
            statusCode: r.response.status,
            body:       r.data ?? (await r.response.text()),
          };
        }
        case 'delete': {
          const r = await c.DELETE(pathArg, baseInit);
          return {
            statusCode: r.response.status,
            body:       r.data ?? (await r.response.text()),
          };
        }
        default:
          throw AgenticEngineError.fromCode(
            'INVALID_ARGUMENT_SCHEMA_VIOLATION',
            `OpenApiHandler: unsupported method ${resolved.method}`,
          );
      }
    } catch (e) {
      if (e instanceof AgenticEngineError) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw AgenticEngineError.fromCode(
        'UPSTREAM_OPENAPI_REQUEST_FAILED',
        `OpenApiHandler: request failed: ${msg}`,
      );
    }
  }
}

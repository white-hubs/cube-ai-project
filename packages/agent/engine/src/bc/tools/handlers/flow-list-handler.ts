/**
 * FlowListHandler — `platform.flow.list`：只读列举中台已配置 Flow（方案 C）。
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { FlowCatalogPort } from '@cube-ai/contracts';
import { AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN } from '@cube-ai/contracts/platform';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

export interface FlowListHandlerInput {
  keyword?: string;
  pageNumber?: number;
  pageSize?: number;
}

export interface FlowListHandlerOutput {
  flows: Array<{
    flowId: string;
    name: string;
    description?: string | null;
    enabled?: boolean | null;
    compileStatus?: string;
  }>;
  pagination?: {
    total: number;
    pages: number;
    currentPage: number;
    pageSize: number;
  };
}

@Injectable()
export class FlowListHandler implements ToolHandler<FlowListHandlerInput, FlowListHandlerOutput> {
  readonly kind = 'flowList' as unknown as ToolHandler['kind'];

  constructor(
    @Inject(AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN)
    private readonly port: FlowCatalogPort,
  ) {}

  async invoke(input: FlowListHandlerInput, ctx: ToolHandlerCtx): Promise<FlowListHandlerOutput> {
    if (input?.keyword != null && typeof input.keyword !== 'string') {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.flow.list keyword must be a string when provided',
      );
    }
    if (input?.keyword != null && input.keyword.length > 256) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.flow.list keyword max length 256',
      );
    }
    if (input?.pageNumber != null && (!Number.isInteger(input.pageNumber) || input.pageNumber < 1)) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.flow.list pageNumber must be a positive integer when provided',
      );
    }
    if (input?.pageSize != null && (!Number.isInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100)) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.flow.list pageSize must be 1..100 when provided',
      );
    }

    const pageNumber = input?.pageNumber ?? (input?.pageSize != null ? 1 : undefined);
    const pageSize = input?.pageSize;
    if (
      (pageNumber != null && pageSize == null) ||
      (pageNumber == null && pageSize != null)
    ) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.flow.list requires both pageNumber and pageSize for paged list',
      );
    }

    try {
      return await this.port.list(
        {
          tenant: ctx.auth.tenant,
          traceId: ctx.traceId,
          ...(input.keyword !== undefined && input.keyword !== '' ? { keyword: input.keyword } : {}),
          ...(pageNumber != null && pageSize != null
            ? { pageNumber, pageSize }
            : {}),
        },
        ctx.signal,
      );
    } catch (e) {
      const code = (e as { code?: string } | null)?.code ?? 'UPSTREAM_TOOL_HTTP_FAILED';
      const msg = e instanceof Error ? e.message : String(e);
      const allowed = new Set([
        'UPSTREAM_TOOL_HTTP_FAILED',
        'UPSTREAM_NETWORK_TIMEOUT',
        'UPSTREAM_AUTH_FAILED',
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'RESOURCE_NOT_FOUND_REMOTE',
      ]);
      const mapped = allowed.has(code)
        ? code === 'RESOURCE_NOT_FOUND_REMOTE'
          ? 'RESOURCE_NOT_FOUND_DESCRIPTOR'
          : code
        : 'UPSTREAM_TOOL_HTTP_FAILED';
      throw AgenticEngineError.fromCode(
        mapped as Parameters<typeof AgenticEngineError.fromCode>[0],
        `platform.flow.list failed: ${msg}`,
      );
    }
  }
}

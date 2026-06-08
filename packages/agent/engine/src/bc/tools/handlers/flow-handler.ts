/**
 * FlowHandler — invokes the AI middle-platform Flow via FlowInvokerPort.
 * v1 主路径：**同步** `LOCAL` tool-use，返回 `{ result, executionTrace? }`（ADR-0020）。
 *
 * ref: docs/detailed-design/07-tools/builtin-catalog.md §6
 *      docs/adr/ADR-0020-platform-flow-sync-intent-routing.md
 */
import { Inject, Injectable } from '@dangao/bun-server';
import type { FlowExecutionTraceItem, FlowInvokerPort } from '@cube-ai/contracts';
import { AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN } from '@cube-ai/contracts/platform';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

const MODEL_TRACE_MAX_ITEMS = Math.max(1, Number(process.env['AGENTIC_FLOW_TRACE_MODEL_MAX_ITEMS'] ?? 64));
const MODEL_TRACE_MAX_CHARS = Math.max(256, Number(process.env['AGENTIC_FLOW_TRACE_MODEL_MAX_CHARS'] ?? 12_000));

function truncateExecutionTraceForModel(
  trace: FlowExecutionTraceItem[] | undefined,
): { executionTrace?: FlowExecutionTraceItem[]; traceTruncated?: boolean } {
  if (!trace?.length) return {};
  let charBudget = MODEL_TRACE_MAX_CHARS;
  const out: FlowExecutionTraceItem[] = [];
  for (let i = 0; i < trace.length && i < MODEL_TRACE_MAX_ITEMS; i++) {
    const item = trace[i]!;
    const piece = JSON.stringify(item);
    if (piece.length > charBudget) {
      return {
        ...(out.length > 0 ? { executionTrace: out } : {}),
        traceTruncated: true,
      };
    }
    out.push(item);
    charBudget -= piece.length;
  }
  return {
    executionTrace: out,
    traceTruncated: trace.length > out.length,
  };
}

export interface FlowHandlerInput {
  flowId: string;
  variables?: Record<string, unknown>;
}

export type FlowHandlerOutput = {
  result: Record<string, unknown>;
  executionTrace?: FlowExecutionTraceItem[];
  traceTruncated?: boolean;
  partial?: boolean;
  error?: unknown;
};

@Injectable()
export class FlowHandler implements ToolHandler<FlowHandlerInput, FlowHandlerOutput> {
  readonly kind = 'flow' as unknown as ToolHandler['kind'];

  constructor(
    @Inject(AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN) private readonly port: FlowInvokerPort,
  ) {}

  async invoke(input: FlowHandlerInput, ctx: ToolHandlerCtx): Promise<FlowHandlerOutput> {
    if (!input?.flowId || typeof input.flowId !== 'string') {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'platform.flow.invoke requires a non-empty string flowId',
      );
    }

    try {
      const resp = await this.port.invoke(
        {
          tenant: ctx.auth.tenant,
          flowId: input.flowId,
          variables: input.variables,
          traceId: ctx.traceId,
        },
        ctx.signal,
      );
      const trimmed = truncateExecutionTraceForModel(resp.executionTrace);
      return {
        result: resp.result,
        ...trimmed,
        ...(resp.partial !== undefined ? { partial: resp.partial } : {}),
        ...('error' in resp && resp.error !== undefined ? { error: resp.error } : {}),
      };
    } catch (e) {
      const code =
        (e as { code?: string } | null)?.code ?? 'UPSTREAM_TOOL_HTTP_FAILED';
      const msg = e instanceof Error ? e.message : String(e);
      const allowed = new Set([
        'UPSTREAM_TOOL_HTTP_FAILED',
        'UPSTREAM_NETWORK_TIMEOUT',
        'UPSTREAM_AUTH_FAILED',
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'RESOURCE_NOT_FOUND_REMOTE',
        'FAILED_PRECONDITION_UPSTREAM',
      ]);
      const mapped = allowed.has(code)
        ? code === 'RESOURCE_NOT_FOUND_REMOTE'
          ? 'RESOURCE_NOT_FOUND_DESCRIPTOR'
          : code
        : 'UPSTREAM_TOOL_HTTP_FAILED';
      throw AgenticEngineError.fromCode(
        mapped as Parameters<typeof AgenticEngineError.fromCode>[0],
        `platform.flow.invoke failed: ${msg}`,
      );
    }
  }
}

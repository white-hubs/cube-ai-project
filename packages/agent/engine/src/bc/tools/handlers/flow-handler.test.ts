import { describe, expect, it } from 'bun:test';
import type { FlowInvokerPort, FlowInvokeRequest, FlowInvokeSyncResponse } from '@cube-ai/contracts';
import { FlowHandler } from './flow-handler';
import type { ToolHandlerCtx } from '../tool-context';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';

function ctx(overrides?: Partial<ToolHandlerCtx>): ToolHandlerCtx {
  return {
    traceId: 'trace-x',
    signal: new AbortController().signal,
    auth: { tenant: 7, user: { userId: 'u1', scopes: [] } },
    session: { id: '1234567890123456789', turnId: '1234567890123456788' },
    ...overrides,
  } as ToolHandlerCtx;
}

class MockFlowPort implements FlowInvokerPort {
  lastReq: FlowInvokeRequest | undefined;
  toReturn: FlowInvokeSyncResponse = { result: { ok: true, phase: 'done' } };
  toThrow: Error | undefined;
  async invoke(req: FlowInvokeRequest): Promise<FlowInvokeSyncResponse> {
    this.lastReq = req;
    if (this.toThrow) throw this.toThrow;
    return this.toReturn;
  }
}

describe('FlowHandler', () => {
  it('forwards tenant from ctx and flowId+variables from input', async () => {
    const port = new MockFlowPort();
    const handler = new FlowHandler(port);
    const out = await handler.invoke({ flowId: 'f-1', variables: { topic: 'x' } }, ctx());
    expect(port.lastReq?.tenant).toBe(7);
    expect(port.lastReq?.flowId).toBe('f-1');
    expect(port.lastReq?.variables).toEqual({ topic: 'x' });
    expect(out.result.ok).toBe(true);
    expect(out.result.phase).toBe('done');
  });

  it('rejects missing flowId with INVALID_ARGUMENT_SCHEMA_VIOLATION', async () => {
    const handler = new FlowHandler(new MockFlowPort());
    let caught: AgenticEngineError | undefined;
    try {
      await handler.invoke({} as { flowId: string }, ctx());
    } catch (e) {
      caught = e as AgenticEngineError;
    }
    expect(caught?.code).toBe('INVALID_ARGUMENT_SCHEMA_VIOLATION');
  });

  it('maps adapter error to UPSTREAM_TOOL_HTTP_FAILED', async () => {
    const port = new MockFlowPort();
    port.toThrow = Object.assign(new Error('boom'), { name: 'GhcloudPlatformError', code: 'UPSTREAM_TOOL_HTTP_FAILED' });
    const handler = new FlowHandler(port);
    let caught: AgenticEngineError | undefined;
    try {
      await handler.invoke({ flowId: 'f-1' }, ctx());
    } catch (e) {
      caught = e as AgenticEngineError;
    }
    expect(caught?.code).toBe('UPSTREAM_TOOL_HTTP_FAILED');
  });
});

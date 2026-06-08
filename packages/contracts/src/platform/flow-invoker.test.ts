import { describe, expect, it } from 'bun:test';
import {
  FlowInvokeRequestSchema,
  FlowInvokeSyncResponseSchema,
  LegacyFlowScheduledEnvelopeSchema,
  type FlowInvokerPort,
} from './flow-invoker';

describe('FlowInvokerPort contracts', () => {
  it('FlowInvokeRequestSchema accepts a valid request', () => {
    const ok = FlowInvokeRequestSchema.parse({
      tenant: 1,
      flowId: '1234567890123456789',
      variables: { foo: 'bar' },
      traceId: 'trace-abc',
    });
    expect(ok.flowId).toBe('1234567890123456789');
    expect(ok.tenant).toBe(1);
    expect(ok.variables).toEqual({ foo: 'bar' });
  });

  it('FlowInvokeRequestSchema rejects missing tenant', () => {
    expect(() =>
      FlowInvokeRequestSchema.parse({
        flowId: 'abc',
        traceId: 'trace-abc',
      }),
    ).toThrow();
  });

  it('FlowInvokeRequestSchema rejects flowId longer than 64 chars', () => {
    expect(() =>
      FlowInvokeRequestSchema.parse({
        tenant: 1,
        flowId: 'x'.repeat(65),
        traceId: 'trace-abc',
      }),
    ).toThrow();
  });

  it('FlowInvokeSyncResponseSchema requires result object', () => {
    expect(() => FlowInvokeSyncResponseSchema.parse({})).toThrow();
    const ok = FlowInvokeSyncResponseSchema.parse({
      result: { ok: true, phase: 'done' },
      executionTrace: [{ kind: 'log', ts: '2026-01-01T00:00:00.000Z' }],
    });
    expect(ok.result.ok).toBe(true);
    expect(ok.executionTrace).toHaveLength(1);
  });

  it('LegacyFlowScheduledEnvelopeSchema still validates old remote shape', () => {
    expect(() =>
      LegacyFlowScheduledEnvelopeSchema.parse({
        scheduled: false,
        jobId: '1234567890123456789',
        statusUrl: '/v1/jobs/1234567890123456789',
      }),
    ).toThrow();

    const ok = LegacyFlowScheduledEnvelopeSchema.parse({
      scheduled: true,
      jobId: '1234567890123456789',
      statusUrl: '/v1/jobs/1234567890123456789',
    });
    expect(ok.scheduled).toBe(true);
  });

  it('LegacyFlowScheduledEnvelopeSchema rejects non-19-digit jobId', () => {
    expect(() =>
      LegacyFlowScheduledEnvelopeSchema.parse({
        scheduled: true,
        jobId: '123',
        statusUrl: '/v1/jobs/123',
      }),
    ).toThrow();
  });

  it('exports the FlowInvokerPort type', () => {
    const fake: FlowInvokerPort = {
      invoke: async () => ({ result: { stub: true } }),
    };
    expect(typeof fake.invoke).toBe('function');
  });
});

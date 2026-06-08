import { describe, test, expect, mock } from 'bun:test';
import type { SessionSseEmitter } from '@cube-ai/bun-server-ext-sse';
import { bridgeGrantRequestToSse } from './grant-sse-bridge';

describe('bridgeGrantRequestToSse', () => {
  test('emits grant-request-v1 with explicit scopeHint PERSISTENT', async () => {
    const emit = mock(async () => {});
    const sse = { emit } as unknown as SessionSseEmitter;

    await bridgeGrantRequestToSse(
      sse,
      {
        type: 'grant-request-v1',
        grantRequestId: '1820345678901234567',
        tenant: 42,
        userId: 'u1',
        toolName: 'platform.flow.invoke',
        sessionId: '1820345678901234001',
        turnId: '1820345678901234002',
        scopeHint: 'PERSISTENT',
      },
      () => 1_700_000_000_000,
    );

    expect(emit).toHaveBeenCalledWith(
      { tenant: 42, sessionId: '1820345678901234001' },
      '1820345678901234002',
      {
        sseEvent: 'grant.request',
        payload: {
          schema: 'grant-request-v1',
          turnId: '1820345678901234002',
          grantRequestId: '1820345678901234567',
          toolName: 'platform.flow.invoke',
          reason: 'Tool call requires approval',
          argsPreview: {},
          scopeHint: 'PERSISTENT',
          expiresTime: 1_700_000_060_000,
        },
      },
    );
  });

  test('emits grant-request-v1 with scopeHint ONCE for EACH_CALL policy', async () => {
    const emit = mock(async () => {});
    const sse = { emit } as unknown as SessionSseEmitter;

    await bridgeGrantRequestToSse(
      sse,
      {
        type: 'grant-request-v1',
        grantRequestId: '1820345678901234567',
        tenant: 42,
        userId: 'u1',
        toolName: 'platform.flow.invoke',
        sessionId: '1820345678901234001',
        turnId: '1820345678901234002',
        scopeHint: 'ONCE',
      },
      () => 1_700_000_000_000,
    );

    expect(emit).toHaveBeenCalledWith(
      { tenant: 42, sessionId: '1820345678901234001' },
      '1820345678901234002',
      expect.objectContaining({
        payload: expect.objectContaining({ scopeHint: 'ONCE' }),
      }),
    );
  });

  test('falls back to PERSISTENT when scopeHint is omitted', async () => {
    const emit = mock(async () => {});
    const sse = { emit } as unknown as SessionSseEmitter;

    await bridgeGrantRequestToSse(
      sse,
      {
        type: 'grant-request-v1',
        grantRequestId: '1820345678901234567',
        tenant: 42,
        userId: 'u1',
        toolName: 'platform.flow.invoke',
        sessionId: '1820345678901234001',
        turnId: '1820345678901234002',
      },
      () => 1_700_000_000_000,
    );

    expect(emit).toHaveBeenCalledWith(
      { tenant: 42, sessionId: '1820345678901234001' },
      '1820345678901234002',
      expect.objectContaining({
        payload: expect.objectContaining({ scopeHint: 'PERSISTENT' }),
      }),
    );
  });

  test('does not emit when sessionId or turnId missing', async () => {
    const emit = mock(async () => {});
    const sse = { emit } as unknown as SessionSseEmitter;

    await bridgeGrantRequestToSse(sse, {
      type: 'grant-request-v1',
      grantRequestId: '1820345678901234567',
      tenant: 42,
      userId: 'u1',
      toolName: 'platform.flow.invoke',
      sessionId: undefined,
      turnId: '1820345678901234002',
    });
    await bridgeGrantRequestToSse(sse, {
      type: 'grant-request-v1',
      grantRequestId: '1820345678901234567',
      tenant: 42,
      userId: 'u1',
      toolName: 'platform.flow.invoke',
      sessionId: '1820345678901234001',
      turnId: undefined,
    });

    expect(emit).not.toHaveBeenCalled();
  });
});


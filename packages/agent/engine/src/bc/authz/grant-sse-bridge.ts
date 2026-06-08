import type { SessionSseEmitter } from '@cube-ai/bun-server-ext-sse';
import type { GrantRequestEventV1 } from './grant.service';

export async function bridgeGrantRequestToSse(
  sseEmitter: SessionSseEmitter,
  evt: GrantRequestEventV1,
  now: () => number = Date.now,
): Promise<void> {
  if (!evt.sessionId || !evt.turnId) return;
  await sseEmitter.emit({ tenant: evt.tenant, sessionId: evt.sessionId }, evt.turnId, {
    sseEvent: 'grant.request',
    payload: {
      schema: 'grant-request-v1',
      turnId: evt.turnId,
      grantRequestId: evt.grantRequestId,
      toolName: evt.toolName,
      reason: 'Tool call requires approval',
      argsPreview: {},
      scopeHint: evt.scopeHint ?? 'PERSISTENT',
      expiresTime: now() + 60_000,
    },
  });
}


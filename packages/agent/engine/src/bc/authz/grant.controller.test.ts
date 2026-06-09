import 'reflect-metadata';
import { describe, test, expect, mock } from 'bun:test';
import type { Context } from '@dangao/bun-server';
import { contextStore } from '@dangao/bun-server';
import { GrantController } from './grant.controller';
import type { GrantService } from './grant.service';

function baseCtx(
  extra: Partial<Context> & {
    getBody?: () => Promise<unknown>;
  } = {},
): Context & { setStatus: ReturnType<typeof mock> } {
  const setStatus = mock(() => {});
  return {
    setStatus,
    query: new URLSearchParams(),
    params: {},
    state: {
      subject: {
        tenant: 42,
        user: {
          userId: 'svc-user',
          tenant: 42,
          displayName: 'Svc User',
          scopes: ['engine.use'],
          rawTokenSha256: 'x',
          expiresAt: Date.now() + 3600_000,
        },
      },
    },
    getBody:
      extra.getBody ??
      mock(async () => ({})),
    ...extra,
  } as unknown as Context & { setStatus: ReturnType<typeof mock> };
}

describe('GrantController', () => {
  test('POST /grants/responses approves grant request', async () => {
    const approveGrant = mock(async () => ({}));
    const denyGrant = mock(async () => {});
    const grantSvc = {
      approveGrant,
      denyGrant,
    } as unknown as GrantService;
    const ctl = new GrantController(grantSvc);
    const ctx = baseCtx({
      getBody: mock(async () => ({
        grantRequestId: '1820345678901234567',
        decision: 'APPROVE',
        scopeChoice: 'PERSISTENT',
      })),
    });

    await contextStore.run(ctx as Context, async () => ctl.respond());

    expect(approveGrant).toHaveBeenCalledWith(
      '1820345678901234567',
      undefined,
      { tenant: 42, userId: 'svc-user', ttlSeconds: 30 * 24 * 3600 },
    );
    expect(ctx.setStatus).toHaveBeenCalledWith(204);
  });

  test('POST /grants/responses denies grant request', async () => {
    const approveGrant = mock(async () => ({}));
    const denyGrant = mock(async () => {});
    const grantSvc = {
      approveGrant,
      denyGrant,
    } as unknown as GrantService;
    const ctl = new GrantController(grantSvc);
    const ctx = baseCtx({
      getBody: mock(async () => ({
        grantRequestId: '1820345678901234567',
        decision: 'DENY',
        note: 'reject',
      })),
    });

    await contextStore.run(ctx as Context, async () => ctl.respond());

    expect(denyGrant).toHaveBeenCalledWith(
      '1820345678901234567',
      'reject',
      { tenant: 42 },
    );
    expect(ctx.setStatus).toHaveBeenCalledWith(204);
  });

  test('POST /grants/responses rejects invalid body', async () => {
    const approveGrant = mock(async () => ({}));
    const denyGrant = mock(async () => {});
    const grantSvc = {
      approveGrant,
      denyGrant,
    } as unknown as GrantService;
    const ctl = new GrantController(grantSvc);
    const ctx = baseCtx({
      getBody: mock(async () => ({
        decision: 'APPROVE',
      })),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.respond())).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT_SCHEMA_VIOLATION',
    });
    expect(approveGrant).not.toHaveBeenCalled();
    expect(denyGrant).not.toHaveBeenCalled();
  });
});


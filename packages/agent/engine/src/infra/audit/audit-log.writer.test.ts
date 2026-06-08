import { describe, test, expect } from 'bun:test';
import type { OutboxWriter } from '@cube-ai/bun-server-ext-outbox';

import { AuditLogWriter } from './audit-log.writer';
import { SfidService } from '../sfid/sfid.service';
import {
  TenantContextService,
  TenantContextMissingError,
} from '../tenant-guard/tenant-context.service';

const TEST_TENANT = 1;

function makeWriter(
  appendFn: OutboxWriter['append'] = async () => {},
): {
  writer: AuditLogWriter;
  tenant: TenantContextService;
} {
  const outbox: OutboxWriter = { append: appendFn };
  const sfid = new SfidService();
  const tenant = new TenantContextService();
  return {
    writer: new AuditLogWriter(outbox, sfid, tenant),
    tenant,
  };
}

const minimalEntry = {
  eventType: 'grant.created',
  eventSchema: 'audit-grant-created-v1',
  severity: 2,
  actor: {
    userId: 'u_123',
    agentId: null,
    tenant: 1,
    principalType: 'USER' as const,
  },
  traceId: 'abc123',
  sessionId: null,
  turnId: null,
  toolCallId: null,
  jobId: null,
  grantRequestId: null,
  subject: 'grant(12345)',
  outcome: 'SUCCESS' as const,
  payloadJson: { grantId: '12345' },
  ipAddress: null,
  userAgent: null,
};

describe('AuditLogWriter', () => {
  test('write() calls outbox.append exactly once', async () => {
    let calls = 0;
    const { writer, tenant } = makeWriter(async () => {
      calls++;
    });
    await tenant.run(TEST_TENANT, async () => {
      await writer.write(minimalEntry);
    });
    expect(calls).toBe(1);
  });

  test('outbox row eventType is prefixed with audit.*', async () => {
    let capturedEventType: string | undefined;
    const { writer, tenant } = makeWriter(async (_tx, row) => {
      capturedEventType = row.eventType;
    });
    await tenant.run(TEST_TENANT, async () => {
      await writer.write({ ...minimalEntry, eventType: 'grant.created' });
    });
    expect(capturedEventType).toBe('audit.grant.created');
  });

  test('outbox row tenant comes from TenantContextService', async () => {
    let capturedTenant: number | undefined;
    const { writer, tenant } = makeWriter(async (_tx, row) => {
      capturedTenant = row.tenant;
    });
    await tenant.run(TEST_TENANT, async () => {
      await writer.write(minimalEntry);
    });
    expect(capturedTenant).toBe(TEST_TENANT);
  });

  test('payload carries SFID id', async () => {
    let payload: { id?: string } | undefined;
    const { writer, tenant } = makeWriter(async (_tx, row) => {
      payload = row.payloadJson as { id?: string };
    });
    await tenant.run(TEST_TENANT, async () => {
      await writer.write(minimalEntry);
    });
    expect(payload?.id).toMatch(/^\d{19}$/);
  });

  test('channel is message_service', async () => {
    let channel: string | undefined;
    const { writer, tenant } = makeWriter(async (_tx, row) => {
      channel = row.channel;
    });
    await tenant.run(TEST_TENANT, async () => {
      await writer.write(minimalEntry);
    });
    expect(channel).toBe('message_service');
  });

  // T10: fail-fast when caller skipped tenantCtx.run() (closes ARCH §9 R-C-7).
  test('write() throws TenantContextMissingError outside tenantCtx.run()', async () => {
    const { writer } = makeWriter();
    let captured: unknown;
    try {
      await writer.write(minimalEntry);
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(TenantContextMissingError);
  });
});

/**
 * Unit tests for AuditLogSafetyAuditAdapter — verifies SafetyAuditEvent →
 * AuditLogWriter → outbox row mapping.
 */
import { describe, expect, test } from 'bun:test';
import type { OutboxWriter } from '@cube-ai/bun-server-ext-outbox';

import { AuditLogWriter } from '../../infra/audit/audit-log.writer';
import { SfidService } from '../../infra/sfid/sfid.service';
import { TenantContextService } from '../../infra/tenant-guard/tenant-context.service';
import {
  AuditLogSafetyAuditAdapter,
  SAFETY_VIOLATION_EVENT_SCHEMA,
  SAFETY_VIOLATION_EVENT_TYPE,
} from './safety-audit.adapter';

const TEST_TENANT = 1;

interface CapturedRow {
  channel: string;
  eventType: string;
  payloadJson: Record<string, unknown> | null;
  tenant: number;
}

function makeAdapter(): {
  adapter: AuditLogSafetyAuditAdapter;
  tenant: TenantContextService;
  rows: CapturedRow[];
} {
  const rows: CapturedRow[] = [];
  const outbox: OutboxWriter = {
    append: async (_tx, row) => {
      rows.push({
        channel: row.channel,
        eventType: row.eventType,
        payloadJson: row.payloadJson as Record<string, unknown> | null,
        tenant: row.tenant,
      });
    },
  };
  const sfid = new SfidService();
  const tenant = new TenantContextService();
  const writer = new AuditLogWriter(outbox, sfid, tenant);
  return {
    adapter: new AuditLogSafetyAuditAdapter(writer),
    tenant,
    rows,
  };
}

describe('AuditLogSafetyAuditAdapter', () => {
  test('deny event → outbox row with severity=3, outcome=DENIED', async () => {
    const { adapter, tenant, rows } = makeAdapter();
    await tenant.run(TEST_TENANT, async () => {
      await adapter.onViolation({
        kind: 'deny',
        policy: 'shell-blacklist',
        reason: 'first-token blocked',
        safetyClass: 'L4_DESTRUCTIVE',
        context: { traceId: 'trace-1', requestId: 'req-1' },
      });
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe(`audit.${SAFETY_VIOLATION_EVENT_TYPE}`);

    // outbox.payloadJson is the full AuditLogEntry; the violation detail
    // sits in entry.payloadJson (inner).
    const entry = rows[0]?.payloadJson as Record<string, unknown>;
    expect(entry['eventType']).toBe(SAFETY_VIOLATION_EVENT_TYPE);
    expect(entry['eventSchema']).toBe(SAFETY_VIOLATION_EVENT_SCHEMA);
    expect(entry['severity']).toBe(3);
    expect(entry['outcome']).toBe('DENIED');
    expect(entry['subject']).toBe('safety:shell-blacklist');
    expect(entry['traceId']).toBe('trace-1');

    const inner = entry['payloadJson'] as Record<string, unknown>;
    expect(inner['kind']).toBe('deny');
    expect(inner['policy']).toBe('shell-blacklist');
    expect(inner['safetyClass']).toBe('L4_DESTRUCTIVE');
    expect(inner['requestId']).toBe('req-1');
  });

  test('mask event → outbox row with severity=2, outcome=PARTIAL', async () => {
    const { adapter, tenant, rows } = makeAdapter();
    await tenant.run(TEST_TENANT, async () => {
      await adapter.onViolation({
        kind: 'mask',
        policy: 'pii-scan',
        reason: 'pii detected; masked',
        safetyClass: 'L1_USER_DATA',
        context: { traceId: 'trace-2' },
        detail: { maskedLength: 42 },
      });
    });

    expect(rows).toHaveLength(1);
    const entry = rows[0]?.payloadJson as Record<string, unknown>;
    expect(entry['outcome']).toBe('PARTIAL');
    expect(entry['severity']).toBe(2);
    expect(entry['subject']).toBe('safety:pii-scan');

    const inner = entry['payloadJson'] as Record<string, unknown>;
    expect(inner['kind']).toBe('mask');
    expect(inner['policy']).toBe('pii-scan');
    expect((inner['detail'] as Record<string, unknown>)['maskedLength']).toBe(42);
  });

  test('outbox row tenant comes from TenantContextService', async () => {
    const { adapter, tenant, rows } = makeAdapter();
    await tenant.run(TEST_TENANT, async () => {
      await adapter.onViolation({
        kind: 'deny',
        policy: 'length-check',
        reason: 'too long',
      });
    });
    expect(rows[0]?.tenant).toBe(TEST_TENANT);
  });

  test('write() failure swallowed (best-effort)', async () => {
    const outbox: OutboxWriter = {
      append: async () => {
        throw new Error('outbox unavailable');
      },
    };
    const sfid = new SfidService();
    const tenantCtx = new TenantContextService();
    const writer = new AuditLogWriter(outbox, sfid, tenantCtx);
    const adapter = new AuditLogSafetyAuditAdapter(writer);

    let raised: unknown;
    try {
      await tenantCtx.run(TEST_TENANT, async () => {
        await adapter.onViolation({
          kind: 'deny',
          policy: 'shell-blacklist',
          reason: 'blocked',
        });
      });
    } catch (e) {
      raised = e;
    }
    expect(raised).toBeUndefined();
  });

  test('missing tenant context → swallowed (does not throw out of onViolation)', async () => {
    const { adapter } = makeAdapter();
    let raised: unknown;
    try {
      await adapter.onViolation({
        kind: 'deny',
        policy: 'shell-blacklist',
        reason: 'no tenant',
      });
    } catch (e) {
      raised = e;
    }
    // AuditLogWriter throws TenantContextMissingError; the adapter must
    // swallow it so safety review flow is unaffected.
    expect(raised).toBeUndefined();
  });
});

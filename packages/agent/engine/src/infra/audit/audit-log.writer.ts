import { Injectable } from '@dangao/bun-server';
import type { AuditLogEntryInput } from '@cube-ai/contracts';
import { AuditLogEntrySchema } from '@cube-ai/contracts';
import type {
  OutboxWriter,
  TransactionContext,
} from '@cube-ai/bun-server-ext-outbox';

import { SfidService } from '../sfid/sfid.service';
import { TenantContextService } from '../tenant-guard/tenant-context.service';
import { severityOf } from './audit-categories';

const NULL_TX = null as unknown as TransactionContext;

/**
 * AuditLogWriter — 经 `OutboxWriter` 写审计（outbox 模式，不直写 DB INSERT）。
 */
@Injectable()
export class AuditLogWriter {
  constructor(
    private readonly outbox: OutboxWriter,
    private readonly sfid: SfidService,
    private readonly tenant: TenantContextService,
  ) {}

  async write(entry: AuditLogEntryInput): Promise<void> {
    const now = Date.now();
    // T10: require active tenant context. Caller (HTTP request, job runner)
    // must wrap the unit of work in `tenantCtx.run(tenant, ...)`.
    // Throws TenantContextMissingError when called outside any run() scope —
    // this is intentional fail-fast behavior to close ARCH §9 R-C-7.
    const tenantId = this.tenant.require();
    const id = this.sfid.next();

    const fullEntry = AuditLogEntrySchema.parse({
      ...entry,
      id,
      tenant: tenantId,
      occurredTime: now,
      severity: entry.severity ?? severityOf(entry.eventType),
    });

    await this.outbox.append(NULL_TX, {
      tenant: fullEntry.tenant,
      channel: 'message_service',
      eventType: `audit.${fullEntry.eventType}`,
      payloadJson: fullEntry,
      target: null,
      scheduleTime: now,
    });
  }
}

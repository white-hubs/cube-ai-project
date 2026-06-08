import { Module } from '@dangao/bun-server';
import {
  type OutboxWriter,
  OutboxExtModule,
  OUTBOX_WRITER_TOKEN,
} from '@cube-ai/bun-server-ext-outbox';

import { SfidService } from '../sfid/sfid.service';
import { TenantContextService } from '../tenant-guard/tenant-context.service';

import { AuditLogWriter } from './audit-log.writer';

/** DI token for AuditLogWriter */
export const AUDIT_LOG_WRITER_TOKEN = Symbol.for(
  'agentic.security.auditWriter',
);

@Module({
  imports: [OutboxExtModule],
  providers: [
    {
      provide: AUDIT_LOG_WRITER_TOKEN,
      useFactory: (
        outbox: OutboxWriter,
        sfid: SfidService,
        tenant: TenantContextService,
      ) => new AuditLogWriter(outbox, sfid, tenant),
      inject: [OUTBOX_WRITER_TOKEN, SfidService, TenantContextService],
    },
  ],
  exports: [AUDIT_LOG_WRITER_TOKEN],
})
export class AuditModule {}

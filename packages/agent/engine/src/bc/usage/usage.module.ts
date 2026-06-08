import { Module } from '@dangao/bun-server';
import {
  OUTBOX_WRITER_TOKEN,
  OutboxWriterImpl,
} from '@cube-ai/bun-server-ext-outbox';
import { SfidService } from '../../infra/sfid/sfid.service';
import { SfidModule } from '../../infra/sfid/sfid.module';
import {
  UsageEventProducerImpl,
  USAGE_EVENT_PRODUCER_TOKEN,
} from './usage-event.producer';

/**
 * Usage BC module (09-usage-events — outbox-backed billing event emit).
 *
 * Registers:
 *   - OUTBOX_WRITER_TOKEN → OutboxWriterImpl（mysql2 INSERT + SfidService）
 *   - USAGE_EVENT_PRODUCER_TOKEN → UsageEventProducerImpl（P3-11 实装 emit）
 *
 * Must be registered BEFORE SessionModule (which depends on UsageEventProducer).
 *
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §6
 */
@Module({
  imports: [SfidModule],
  providers: [
    {
      provide: OUTBOX_WRITER_TOKEN,
      useFactory: (sfid: SfidService) =>
        new OutboxWriterImpl({ nextSfid: () => sfid.next() }),
      inject: [SfidService],
    },
    {
      provide: USAGE_EVENT_PRODUCER_TOKEN,
      useClass: UsageEventProducerImpl,
    },
  ],
  exports: [USAGE_EVENT_PRODUCER_TOKEN],
})
export class UsageModule {}

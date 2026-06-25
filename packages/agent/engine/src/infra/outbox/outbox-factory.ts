import type { Pool } from 'mysql2/promise';
import { OutboxWriterImpl, type OutboxWriter } from '@cube-ai/bun-server-ext-outbox';

import { sharedSfidService } from '../sfid/shared-sfid';

/** 管理面/上架等 POST-commit outbox 写入：必须带 pool 才能用 NULL_TX 独立事务。 */
export function buildOutboxWriter(pool: Pool | null): OutboxWriter | undefined {
  if (!pool) return undefined;
  return new OutboxWriterImpl({
    nextSfid: () => sharedSfidService.next(),
    pool,
  });
}

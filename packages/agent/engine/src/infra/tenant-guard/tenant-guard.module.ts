import { Module } from '@dangao/bun-server';
import { TenantContextService } from './tenant-context.service';

/**
 * DI module for tenant context propagation.
 * ref: docs/technical-design/phase-1/P1-01-foundations.md §6.2
 */
@Module({
  providers: [TenantContextService],
  exports: [TenantContextService],
})
export class TenantGuardModule {}

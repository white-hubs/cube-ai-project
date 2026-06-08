import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@dangao/bun-server';

/**
 * Tenant ID type — INT(10) range (0..2_147_483_647).
 * Must match `TenantSchema` in `@cube-ai/contracts`.
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §2.2
 */
export type TenantId = number;

/**
 * Thrown by `TenantContextService.require()` when no tenant context is
 * active. Other domains should catch this and map it to AgenticAuthZError
 * or AgenticInternalError as appropriate.
 *
 * ref: docs/technical-design/phase-1/P1-01-foundations.md §3.2
 */
export class TenantContextMissingError extends Error {
  constructor() {
    super('[TenantContextService] No tenant context active. Call run() first.');
    this.name = 'TenantContextMissingError';
  }
}

/**
 * AsyncLocalStorage-based tenant context carrier.
 *
 * Usage in middleware / request handler:
 *
 *   await tenantCtx.run(authContext.tenant, async () => {
 *     return await sessionService.create(dto);
 *   });
 *
 * Within any code reachable from `fn`, `current()` returns the tenant.
 * Nesting is supported — inner `run()` calls shadow the outer tenant for
 * their subtree.
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §2.2
 *      ARCH.md §5 G-7 (AsyncLocalStorage gap — partially closed by this impl)
 *      docs/technical-design/phase-1/P1-01-foundations.md §3.2
 */
@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantId>();

  /**
   * Execute `fn` within a tenant context.
   * Supports both synchronous and Promise-returning functions.
   */
  run<T>(tenant: TenantId, fn: () => T): T {
    return this.storage.run(tenant, fn);
  }

  /**
   * Return the current tenant ID, or `undefined` if not inside a `run()`.
   */
  current(): TenantId | undefined {
    return this.storage.getStore();
  }

  /**
   * @deprecated Phase-1 placeholder. Returns `1` as a fallback when no
   * tenant scope is active, which violates ARCH §9 R-C-7 (cross-tenant
   * leakage risk). Use `current()` (returns `undefined` when outside any
   * `run()` scope) or `require()` (throws `TenantContextMissingError`)
   * instead. T10 migrated all internal callers to `require()`; this method
   * is retained for one release for SDK consumers and will be removed.
   *
   * ref: docs/technical-design/phase-4/T10-tenant-context-migration.md
   */
  getCurrentTenant(): TenantId {
    return this.storage.getStore() ?? 1;
  }

  /**
   * Return the current tenant ID, throwing `TenantContextMissingError` if
   * no context is active. Use this in service methods that must always run
   * within a tenant scope.
   */
  require(): TenantId {
    const tenant = this.storage.getStore();
    if (tenant === undefined) {
      throw new TenantContextMissingError();
    }
    return tenant;
  }
}

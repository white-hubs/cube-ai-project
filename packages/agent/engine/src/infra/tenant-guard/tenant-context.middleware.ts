import type { Middleware } from '@dangao/bun-server';
import type { TenantContextService } from './tenant-context.service';

/**
 * Tenant context propagation middleware.
 *
 * Wraps each request in `tenantCtx.run(subject.tenant, ...)` so any downstream
 * service can read the active tenant via `AsyncLocalStorage`
 * (`TenantContextService.current()` / `require()`). When `ctx.state.subject` is
 * absent — `/health/*`, `/metrics`, mock-OBO JWKS and any other path bypassed
 * by `oauth2IntrospectionMiddleware` — the request passes through without
 * establishing a tenant scope.
 *
 * Ordering — must run AFTER `oauth2IntrospectionMiddleware` (which writes
 * `ctx.state.subject` per `DualSubjectSchema`) and BEFORE
 * `errorResponseMiddleware`. ADR-0019 fixes a 4-step protocol-layer chain;
 * this middleware is a context-propagation derivative and does not alter the
 * protocol-layer semantics (no header rewrite, no envelope shaping).
 *
 * ref: ARCH.md §9 R-C-7 (cross-tenant leak risk closed by T10)
 *      docs/adr/ADR-0019-middleware-chain-order.md
 *      docs/technical-design/phase-4/T10-tenant-context-migration.md
 */
export function createTenantContextMiddleware(
  svc: TenantContextService,
): Middleware {
  return async (ctx, next) => {
    const state = (
      ctx as {
        state?: {
          subject?: {
            tenant?: number;
            user?: { tenant?: number };
          };
        };
      }
    ).state;
    // DualSubjectSchema exposes both `subject.tenant` (root convenience copy)
    // and `subject.user.tenant`; prefer the root field, fall back for safety.
    const tenant = state?.subject?.tenant ?? state?.subject?.user?.tenant;
    if (typeof tenant !== 'number') {
      return next();
    }
    return svc.run(tenant, () => next());
  };
}

import type { Context, Middleware, NextFunction } from '@dangao/bun-server';
import { tenantContextAls } from './access-scope';

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Align with CubeGateway / knowledge-retrieval callback headers. */
function resolveKbTenantHeader(ctx: Context): string {
  return (
    ctx.request.headers.get('tenant')?.trim() ??
    ctx.request.headers.get('x-tenant-id')?.trim() ??
    ctx.request.headers.get('x-project-id')?.trim() ??
    ''
  );
}

/** Injects kb-core tenant ALS for retrieval / document routes (separate from server-shared ALS). */
export function createKbTenantContextMiddleware(): Middleware {
  const prefixes = ['/search', '/documents'];
  return async (ctx: Context, next: NextFunction) => {
    const path = ctx.path;
    if (!prefixes.some((prefix) => matchesPrefix(path, prefix))) {
      return next();
    }
    const tenantId = resolveKbTenantHeader(ctx);
    if (!tenantId) {
      return next();
    }
    return tenantContextAls.run({ tenantId }, () => next());
  };
}

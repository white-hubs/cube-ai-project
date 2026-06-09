import type { Middleware } from '@dangao/bun-server';

const DOMAIN_PREFIXES = ['/flow', '/kb', '/agent'] as const;

/**
 * ADR-0008 domain prefixes: strip `/flow|/kb|/agent` before controller routing
 * so existing BC controllers stay at legacy paths (`/flows`, `/documents`, `/sessions`, …).
 * `/llm` is intentionally excluded: LlmCatalogAdminController is mounted at `/llm` and routes directly.
 */
export function createDomainPathRewriteMiddleware(): Middleware {
  return async (ctx, next) => {
    const mutable = ctx as { path: string };
    const path = mutable.path ?? '';
    for (const prefix of DOMAIN_PREFIXES) {
      if (path === prefix) {
        mutable.path = '/';
        break;
      }
      if (path.startsWith(`${prefix}/`)) {
        mutable.path = path.slice(prefix.length) || '/';
        break;
      }
    }
    return next();
  };
}

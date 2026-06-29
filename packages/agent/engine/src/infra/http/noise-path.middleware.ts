/**
 * Short-circuit common browser / crawler probe paths and the API root.
 *
 * Browsers request `/favicon.ico` (often via HEAD) when a tab points at the
 * API origin. Those probes carry no Bearer token and would otherwise fall
 * through ghcloud JWT auth as noisy 401 error logs. We answer 404 here, before
 * auth and error-envelope middleware, and never call `next()`.
 *
 * `GET /` (and other methods on `/`) returns a minimal 200 `status ok` body so
 * opening the server origin in a browser does not hit auth either.
 *
 * Chain placement: immediately after `traceIdMiddleware`.
 */
import type { Context, Middleware, NextFunction } from "@dangao/bun-server";

export const ROOT_OK_PATH = "/";
export const ROOT_OK_BODY = "status ok";

/** Exact paths that should never hit auth or business routes. */
export const NOISE_PATHS: ReadonlySet<string> = new Set([
  "/favicon.ico",
  "/robots.txt",
  "/apple-touch-icon.png",
  "/apple-touch-icon-precomposed.png",
  "/site.webmanifest",
  "/manifest.webmanifest",
  "/browserconfig.xml",
]);

function resolvePath(ctx: Context): string {
  const c = ctx as unknown as { path?: string; url?: string | URL };
  if (typeof c.path === "string" && c.path.length > 0) return c.path;
  const u = c.url;
  if (u instanceof URL) return u.pathname;
  if (typeof u === "string") return u.split("?")[0] ?? "";
  return "";
}

export function isNoisePath(path: string): boolean {
  return NOISE_PATHS.has(path);
}

export function createNoisePathMiddleware(paths: ReadonlySet<string> = NOISE_PATHS): Middleware {
  return async (ctx: Context, _next: NextFunction) => {
    const path = resolvePath(ctx);
    if (path === ROOT_OK_PATH) {
      return new Response(ROOT_OK_BODY, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (paths.has(path)) {
      return new Response(null, { status: 404 });
    }
    return _next();
  };
}

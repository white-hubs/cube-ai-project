import { UnauthorizedException, type Context, type Middleware, type NextFunction } from "@dangao/bun-server";
import { timingSafeEqual } from "node:crypto";

import { authenticatedUserAls, developerApiAls, tenantContextAls } from "@cube-ai/ai-center/platform/server-shared";

import type { AccessTokenReader, DeveloperApiKeyReader } from "./middleware-types";

function parseBearerAuth(headerValue: string | null): string | null {
  const raw = headerValue?.trim() ?? "";
  if (!raw || !raw.toLowerCase().startsWith("bearer ")) return null;
  const token = raw.slice(7).trim();
  return token !== "" ? token : null;
}

function parseApiKeyHeader(headerValue: string | null): string | null {
  const raw = headerValue?.trim() ?? "";
  return raw !== "" ? raw : null;
}

function resolveTenantHeader(ctx: Context): string {
  return (
    ctx.request.headers.get("tenant")?.trim() ??
    ctx.request.headers.get("x-tenant-id")?.trim() ??
    ctx.request.headers.get("x-project-id")?.trim() ??
    ""
  );
}

function apiKeysMatch(expected: string, actual: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isPublicPath(path: string): boolean {
  return path === "/health" || path.startsWith("/health/") || path === "/metrics";
}

/**
 * Verifies Bearer token or host-managed API key (builtin system key / injected reader)
 * and injects tenant context into ALS.
 */
export function createExecutionAuthMiddleware(deps: {
  accessTokenReader: AccessTokenReader;
  apiKeyReader?: DeveloperApiKeyReader;
  /** Host builtin key for in-process callbacks (knowledge-retrieval → POST /kb/search/*). */
  builtinSystemApiKey?: string;
  prefixes?: string[];
}): Middleware {
  const prefixes = deps.prefixes ?? ["/oauth2"];
  const builtinKey = deps.builtinSystemApiKey?.trim() ?? "";

  return async (ctx: Context, next: NextFunction) => {
    if (isPublicPath(ctx.path) || prefixes.some((prefix) => ctx.path.startsWith(prefix))) {
      return next();
    }
    const rawToken = parseBearerAuth(ctx.request.headers.get("authorization"));
    if (rawToken) {
      const auth = await deps.accessTokenReader.verifyAccessToken(rawToken);
      if (auth) {
        const tenantRaw = resolveTenantHeader(ctx);
        const bypassIsolation = auth.isSuperAdmin && tenantRaw === "";
        return authenticatedUserAls.run(auth, () =>
          tenantContextAls.run({ tenantId: tenantRaw, bypassTenantIsolation: bypassIsolation }, () => next()),
        );
      }
    }

    const rawApiKey = parseApiKeyHeader(ctx.request.headers.get("x-api-key")) ?? parseApiKeyHeader(ctx.request.headers.get("X-Api-Key"));
    if (rawApiKey) {
      const record = deps.apiKeyReader ? await deps.apiKeyReader.verifyApiKeyRaw(rawApiKey) : null;
      const builtinMatch = builtinKey !== "" && apiKeysMatch(builtinKey, rawApiKey);
      if (record || builtinMatch) {
        const tenantRaw = resolveTenantHeader(ctx);
        // Registered keys are tenant-scoped. `project_id` is the legacy reader
        // field name; ADR-0012 retired project as an isolation dimension.
        // Never let a caller replace the key's tenant with an arbitrary header.
        const registeredTenantId = record?.project_id?.trim() ?? "";
        if (record && registeredTenantId === "") {
          throw new UnauthorizedException("API key is not bound to a tenant");
        }
        if (record && tenantRaw !== "" && tenantRaw !== registeredTenantId) {
          throw new UnauthorizedException("API key tenant does not match request tenant");
        }
        // FLOW-AUTH-01 accepted exception: the builtin system key keeps its
        // dynamic tenant header until the Flow knowledge-retrieval callback is redesigned.
        const tenantId = record ? registeredTenantId : tenantRaw || null;
        return developerApiAls.run(
          {
            apiKeyId: record?.id ?? "builtin-system",
            flowIdScope: record?.flow_id ?? null,
            accessLevel: record?.access_level ?? "system",
            tenantId,
          },
          () =>
            tenantContextAls.run(
              {
                tenantId: record ? registeredTenantId : tenantRaw,
                bypassTenantIsolation: record ? false : tenantRaw === "",
              },
              () => next(),
            ),
        );
      }
    }

    throw new UnauthorizedException("missing or invalid bearer token");
  };
}

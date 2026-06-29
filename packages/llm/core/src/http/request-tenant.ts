import { Inject, Injectable } from "@dangao/bun-server";

export const LLM_HTTP_TENANT_RESOLVER_TOKEN = Symbol.for("cube-ai.llm-http-tenant-resolver");

export type LlmHttpTenantResolver = () => number;

/** Parse tenant header / ALS string into a finite tenant id (ADR-0012 INT range). */
export function parseTenantId(raw: string | null | undefined): number | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

@Injectable()
export class LlmHttpTenantResolverService {
  public constructor(
    @Inject(LLM_HTTP_TENANT_RESOLVER_TOKEN)
    private readonly resolve: LlmHttpTenantResolver,
  ) {
    // Fail loud (never silently default to tenant 0 — that would break tenant
    // isolation, ADR-0012). Surfaces wiring regressions at construction time
    // with an actionable message instead of a cryptic `this.resolve is not a
    // function` at request time.
    if (typeof this.resolve !== "function") {
      throw new TypeError(
        `LlmHttpTenantResolverService requires a tenant resolver function but received ${typeof this.resolve}. ` +
          "Check LLM_HTTP_TENANT_RESOLVER_TOKEN wiring in LlmCatalogHttpModule / AiCenterDomainHttpModule.",
      );
    }
  }

  public require(): number {
    return this.resolve();
  }
}

export function createEnvFallbackTenantResolver(resolveActive?: () => number | undefined): LlmHttpTenantResolver {
  return () => {
    const active = resolveActive?.();
    if (active !== undefined && Number.isFinite(active)) {
      return active;
    }
    const raw = process.env.LLM_HTTP_DEFAULT_TENANT?.trim() ?? process.env.AGENTIC_ENGINE_MEMORY_TENANT_ID?.trim() ?? "0";
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
}

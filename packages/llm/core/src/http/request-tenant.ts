import { Inject, Injectable } from '@dangao/bun-server';

export const LLM_HTTP_TENANT_RESOLVER_TOKEN = Symbol.for('cube-ai.llm-http-tenant-resolver');

export type LlmHttpTenantResolver = () => number;

@Injectable()
export class LlmHttpTenantResolverService {
  public constructor(
    @Inject(LLM_HTTP_TENANT_RESOLVER_TOKEN)
    private readonly resolve: LlmHttpTenantResolver,
  ) {}

  public require(): number {
    return this.resolve();
  }
}

export function createEnvFallbackTenantResolver(
  resolveActive?: () => number | undefined,
): LlmHttpTenantResolver {
  return () => {
    const active = resolveActive?.();
    if (active !== undefined && Number.isFinite(active)) {
      return active;
    }
    const raw =
      process.env.LLM_HTTP_DEFAULT_TENANT?.trim() ??
      process.env.AGENTIC_ENGINE_MEMORY_TENANT_ID?.trim() ??
      '0';
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
}

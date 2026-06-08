/**
 * TrustAgreementRegistry — manages downstream trust agreements for Mock OBO.
 *
 * Three agreement types:
 *   - self_agent:          engine trusts its own JWKS
 *   - org_agent:           engine trusts another org agent on the same OUAA
 *   - cross_tenant_agent:  engine trusts a cross-tenant agent (separate OUAA)
 *
 * Phase 1: in-memory registry seeded from env/config.
 * Phase 2: persist to DB + load from Nacos.
 *
 * ref: docs/detailed-design/04-auth-and-authz/trust-agreement.md §3
 */
import type { TrustAgreement, TrustAgreementType } from '@cube-ai/contracts';

export class TrustAgreementRegistry {
  private readonly agreements = new Map<string, TrustAgreement>();

  /**
   * Register a trust agreement.
   * Duplicate IDs overwrite.
   */
  register(agreement: TrustAgreement): void {
    this.agreements.set(agreement.id, agreement);
  }

  /** Lookup by clientId */
  findByClientId(clientId: string): TrustAgreement | null {
    for (const a of this.agreements.values()) {
      if (a.clientId === clientId && a.active) return a;
    }
    return null;
  }

  /** Find all active agreements of a given type */
  findByType(type: TrustAgreementType): TrustAgreement[] {
    return [...this.agreements.values()].filter(a => a.type === type && a.active);
  }

  /** Check if an audience alias is trusted */
  isAudienceTrusted(clientId: string, audience: string): boolean {
    const agreement = this.findByClientId(clientId);
    if (!agreement) return false;
    return agreement.acceptedAudienceAliases.includes(audience);
  }

  /** Check if a scope is allowed for a downstream */
  isScopeAllowed(clientId: string, scope: string): boolean {
    const agreement = this.findByClientId(clientId);
    if (!agreement) return false;
    return agreement.allowedScopes.includes(scope);
  }

  /** List all active agreements */
  listActive(): TrustAgreement[] {
    return [...this.agreements.values()].filter(a => a.active);
  }
}

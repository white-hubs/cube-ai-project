/**
 * AuthorizationGateway — the single authorization decision point for Tool calls.
 *
 * Implements the 5-step decision algorithm from authorization-gateway.md §3.3:
 *   1. Load G-A / G-B / G-D / G-C grants
 *   2. Filter: scope match + subject match + not expired/revoked
 *   3. Prioritized decision chain:
 *      (a) G-A DENY  → DENY (admin_deny)
 *      (b) G-A ALLOW → ALLOW (admin_allow — bypasses consent ceremony)
 *      (c) G-B/D hit → ALLOW (user_default)
 *      (d) G-C hit   → ALLOW + consume (session_ephemeral)
 *      (e) Fallback by consentPolicy
 *
 * ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md §1 – §3
 *      docs/detailed-design/04-auth-and-authz/authorization-gateway.md §5 DSL
 *      docs/adr/ADR-0011-user-grant-model.md
 */
import { TenantIsolationViolation } from '../../infra/errors/agentic-error';
import { GrantService, type SessionGrantWithId } from './grant.service';
import { ConsentPolicyEngine, type EvalContext } from './consent-policy.engine';
import { isGrantActive } from './grant-state-machine';
import type {
  AuthzRequest,
  AuthzDecision,
  Grant,
  ArgsConstraint,
} from '@cube-ai/contracts';

/**
 * AuthzGatewayService evaluates the full authorization decision.
 *
 * Invariants (ref: authorization-gateway.md §1.2):
 *   I-1: Decision is made BEFORE OBO token exchange
 *   I-2: G-A DENY has highest priority
 *   I-3: Pure function — same input → same output
 *   I-4: Output is strictly ALLOW | DENY | REQUIRE_CONSENT
 */
export class AuthzGatewayService {
  constructor(
    private readonly grantService: GrantService,
    private readonly consentPolicyEngine: ConsentPolicyEngine,
  ) {}

  /**
   * Make an authorization decision for a Tool call.
   * ref: authorization-gateway.md §3.3 algorithm
   */
  async check(req: AuthzRequest): Promise<AuthzDecision> {
    if (req.toolTenant != null && req.toolTenant !== req.tenant) {
      throw new TenantIsolationViolation(
        `AuthZ: tool tenant ${req.toolTenant} !== user tenant ${req.tenant}`,
      );
    }

    const evalCtx: EvalContext = {
      'principal.userId': req.userId,
      'principal.tenant': req.tenant,
      'session.agentId': req.agentId,
      'session.sessionId': req.sessionId,
    };

    let gA: Grant[] = [];
    let gBD: Grant[] = [];
    let gC: SessionGrantWithId[] = [];

    gA = await this.grantService.loadAdminGrants(req.tenant);
    gBD = await this.grantService.loadUserGrants(req.tenant, req.userId);

    if (req.sessionId) {
      gC = await this.grantService.loadSessionGrants(req.sessionId);
    }

    // Step 2 — filter: active + scope match + subject match
    const matchFn = (g: Grant) =>
      isGrantActive(g) &&
      this.scopeMatches(g, req.toolName, req.args, evalCtx) &&
      this.subjectMatches(g, req);

    const gA_matching = gA.filter(matchFn);
    const gBD_matching = gBD.filter(matchFn);
    const gC_matching = gC.filter(
      sg => !sg.consumeTime && this.sessionScopeMatches(sg, req.toolName, req.args, evalCtx),
    );

    // Step 3(a) — G-A DENY: highest priority (I-2)
    const gA_deny = gA_matching.find(g => g.scope.action === 'DENY');
    if (gA_deny) {
      return {
        kind: 'DENY',
        reason: 'admin_deny',
        violatedGrantId: gA_deny.id,
      };
    }

    // Step 3(b) — G-A ALLOW (bypasses consent ceremony)
    const gA_allow = gA_matching.find(g => g.scope.action === 'ALLOW');
    if (gA_allow) {
      return {
        kind: 'ALLOW',
        reason: 'admin_allow',
        grantId: gA_allow.id,
      };
    }

    // Step 3(c) — G-B / G-D
    const gBD_hit = gBD_matching[0];
    if (gBD_hit) {
      return {
        kind: 'ALLOW',
        reason: 'user_default',
        grantId: gBD_hit.id,
      };
    }

    // Step 3(d) — G-C one-shot
    const gC_hit = gC_matching[0];
    if (gC_hit) {
      if (req.sessionId) {
        await this.grantService.consumeSessionGrant(req.sessionId, gC_hit.grantId);
      }
      return {
        kind: 'ALLOW',
        reason: 'session_ephemeral',
      };
    }

    // Step 3(e) — fallback by consentPolicy
    switch (req.consentPolicy) {
      case 'NEVER':
        return { kind: 'ALLOW', reason: 'policy_never' };
      case 'EACH_CALL':
        return { kind: 'REQUIRE_CONSENT', reason: 'policy_each_call', scopeHint: 'ONCE' };
      case 'ON_FIRST_USE':
        return { kind: 'REQUIRE_CONSENT', reason: 'policy_on_first_use', scopeHint: 'PERSISTENT' };
      case 'ADMIN_ONLY':
        return { kind: 'DENY', reason: 'admin_only_not_approved' };
    }
  }

  private scopeMatches(
    grant: Grant,
    toolName: string,
    args: unknown,
    evalCtx: EvalContext,
  ): boolean {
    const scope = grant.scope;

    // Tool name match (exact or prefix wildcard)
    if (scope.toolName && scope.toolName !== toolName) return false;
    if (scope.toolPattern) {
      const prefix = scope.toolPattern.replace(/\.\*$/, '.');
      if (!toolName.startsWith(prefix)) return false;
    }

    // Args constraint DSL evaluation
    if (scope.argsConstraintJson) {
      return this.evalConstraint(scope.argsConstraintJson, toolName, args, evalCtx);
    }

    return true;
  }

  private sessionScopeMatches(
    sg: SessionGrantWithId,
    toolName: string,
    args: unknown,
    evalCtx: EvalContext,
  ): boolean {
    const scope = sg.scope;
    if (scope.toolName && scope.toolName !== toolName) return false;
    if (scope.toolPattern) {
      const prefix = scope.toolPattern.replace(/\.\*$/, '.');
      if (!toolName.startsWith(prefix)) return false;
    }
    if (sg.argsConstraintJson) {
      return this.evalConstraint(sg.argsConstraintJson, toolName, args, evalCtx);
    }
    return true;
  }

  private evalConstraint(
    constraint: ArgsConstraint,
    toolName: string,
    args: unknown,
    evalCtx: EvalContext,
  ): boolean {
    const root = { toolName, args, context: evalCtx };
    const results = constraint.matches.map(m =>
      this.consentPolicyEngine.evaluate(m as never, root as never, evalCtx),
    );
    if (constraint.all !== false) {
      return results.every(Boolean);
    }
    return results.some(Boolean);
  }

  private subjectMatches(grant: Grant, req: AuthzRequest): boolean {
    const s = grant.subject;
    if (s.userId && s.userId !== req.userId) return false;
    if (s.agentId && s.agentId !== req.agentId) return false;
    if (s.sessionId && s.sessionId !== req.sessionId) return false;
    // s.userGroupId: M1 skip (authorization-gateway.md §6.2)
    return true;
  }
}

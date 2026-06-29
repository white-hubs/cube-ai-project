/**
 * Dual-subject identity contracts.
 *
 * Ref: docs/detailed-design/04-auth-and-authz/README.md §4.2 AuthContext data structure
 *      docs/adr/ADR-0004-oauth2-dual-principal.md (dual principal model)
 */
import { z } from "zod";

/**
 * User identity extracted from OAuth2 Bearer token.
 * ref: oauth2-flow.md §5.1 Claim → UserPrincipal mapping
 */
export const UserPrincipalSchema = z.object({
  /** Display name — placeholder empty string in Phase 1; ref oauth2-flow.md §5.1 [待确认] */
  displayName: z.string().default(""),
  /** epoch ms (exp × 1000) */
  expiresAt: z.number(),
  /** SHA-256 of the raw access_token — only first 8 chars logged; never persisted */
  rawTokenSha256: z.string(),
  /** OAuth2 scopes from `scope` claim (space-split) */
  scopes: z.array(z.string()).readonly(),
  /** INT(10) at app layer; from `tenant_id` claim parseInt */
  tenant: z.number().int().positive(),
  /** Platform user identifier (from `user_name` claim, fallback `sub`) */
  userId: z.string().min(1),
});

export type UserPrincipal = z.infer<typeof UserPrincipalSchema>;

/**
 * Service identity of the engine itself (client_credentials grant).
 * ref: oauth2-flow.md §3 ServicePrincipal lifecycle
 */
export const ServicePrincipalSchema = z.object({
  clientId: z.string(),
  /** epoch ms */
  expiresAt: z.number(),
  scopes: z.array(z.string()).readonly(),
  /** Optional: present when a specific tenant context is required */
  tenant: z.number().int().positive().optional(),
});

export type ServicePrincipal = z.infer<typeof ServicePrincipalSchema>;

/**
 * The dual-subject context injected into ctx.state.subject by the Auth middleware.
 * Carries both the authenticated user and traceId for downstream use.
 * ref: README.md §4.2 AuthContext
 */
export const DualSubjectSchema = z.object({
  /** Service identity derived from introspection (`client_id` / `aud`) when present */
  service: ServicePrincipalSchema.optional(),
  /** Convenience copy matching UserPrincipal.tenant */
  tenant: z.number().int().positive(),
  /** Terminal identifier from X-Terminal header / token claim */
  terminal: z.string().optional(),
  /** Raw token JTI for audit — not exposed to business logic */
  tokenJti: z.string().optional(),
  traceId: z.string(),
  user: UserPrincipalSchema,
});

export type DualSubject = z.infer<typeof DualSubjectSchema>;

/** OBO exchange input */
export const OboExchangeInputSchema = z.object({
  audience: z.string().optional(),
  subjectUserId: z.string().min(1),
  targetScope: z.array(z.string()).readonly(),
  /** INT(10) */
  tenant: z.number().int().positive(),
  traceId: z.string(),
  /** Hint in seconds; provider enforces hard upper limit (900s normal, 86400s jobs) */
  ttlHintSeconds: z.number().int().positive().optional(),
});

export type OboExchangeInput = z.infer<typeof OboExchangeInputSchema>;

/**
 * Trust agreement contracts for Mock OBO downstream trust.
 *
 * Ref: docs/detailed-design/04-auth-and-authz/trust-agreement.md
 *      docs/detailed-design/04-auth-and-authz/mock-obo.md §2
 */
import { z } from "zod";

/**
 * Three trust agreement types as defined in trust-agreement.md.
 * (Note: the M1 document groups these under "client / scope / pubkey / audit" —
 *  P1-05 models the types as a discriminated union for the registry.)
 */
export const TrustAgreementTypeSchema = z.enum([
  /** Engine trusts itself (internal JWKS) */
  "self_agent",
  /** Engine trusts another org's agent (same platform OUAA) */
  "org_agent",
  /** Engine trusts a cross-tenant agent (separate OUAA or federation) */
  "cross_tenant_agent",
]);
export type TrustAgreementType = z.infer<typeof TrustAgreementTypeSchema>;

/**
 * A registered trust agreement entry.
 * ref: trust-agreement.md §3 + §7 downstream checklist
 */
export const TrustAgreementSchema = z.object({
  /** Audience aliases this downstream accepts */
  acceptedAudienceAliases: z.array(z.string()),
  active: z.boolean().default(true),
  /** OAuth2 scopes this downstream accepts */
  allowedScopes: z.array(z.string()),
  /** client_id on the platform */
  clientId: z.string(),
  createTime: z.number(),
  /** Human-readable description */
  description: z.string().optional(),
  id: z.string(),
  /** JWKS URI to verify tokens from this party */
  jwksUri: z.string().url(),
  type: TrustAgreementTypeSchema,
  updateTime: z.number(),
});

export type TrustAgreement = z.infer<typeof TrustAgreementSchema>;

/**
 * Mock OBO key metadata (stored in Nacos secrets).
 * ref: mock-obo.md §2.2 Signing keys
 */
export const MockOboKeyMetaSchema = z.object({
  algorithm: z.literal("RS256"),
  /** Whether this is the current active signing key */
  current: z.boolean(),
  /** kid e.g. "agentic-engine-mock-obo-v1" */
  kid: z.string(),
  /** Rotation eligibility — keys older than maxTtlSeconds may be pruned */
  maxTtlSeconds: z.number().int().positive().default(7776000),
  /** PEM PKCS#8 private key ref — resolved from Nacos secrets at runtime */
  privateKeyRef: z.string(),
});

export type MockOboKeyMeta = z.infer<typeof MockOboKeyMetaSchema>;

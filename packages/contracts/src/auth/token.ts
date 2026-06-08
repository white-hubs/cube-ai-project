/**
 * OAuth2 token contracts for the Auth domain.
 *
 * Ref: docs/detailed-design/04-auth-and-authz/oauth2-flow.md §5.1 Claim mapping
 *      docs/detailed-design/04-auth-and-authz/mock-obo.md §2.1 OBO JWT payload
 */
import { z } from 'zod';

/**
 * Platform OAuth2 Introspection response schema.
 * Aligns with Spring Authorization Server + Redis backend (E-1 source).
 * ref: oauth2-flow.md §1.1, §5.1
 */
export const OAuth2IntrospectResponseSchema = z.object({
  active: z.boolean(),
  /** OAuth client that requested the token (RFC 7662 / Spring) */
  client_id: z.string().optional(),
  /** Platform user identifier (preferred; may also appear as `sub`) */
  user_name: z.string().optional(),
  /** RFC 7662 alternate username field (some IdPs) */
  username: z.string().optional(),
  sub: z.string().optional(),
  /** Tenant identifier — string in JWT claim, converted to INT(10) at app layer */
  tenant_id: z.string().optional(),
  scope: z.string().optional(),
  terminal: z.string().optional(),
  /** JWT ID — for audit */
  jti: z.string().optional(),
  /** Expiry in epoch seconds */
  exp: z.number().optional(),
  iss: z.string().optional(),
  aud: z.union([z.string(), z.array(z.string())]).optional(),
});

export type OAuth2IntrospectResponse = z.infer<typeof OAuth2IntrospectResponseSchema>;

/**
 * Cached AuthN token state stored in Redis.
 * Key: agentic:engine:auth:token:{sha256(access_token)}
 * TTL: min(exp - now, 60s)   active=true
 *      30s                   active=false (negative cache)
 * ref: oauth2-flow.md §4
 */
export const CachedTokenStateSchema = z.object({
  active: z.boolean(),
  userId: z.string().optional(),
  /** INT(10) at app layer */
  tenant: z.number().int().optional(),
  scopes: z.array(z.string()),
  terminal: z.string().optional(),
  /** epoch ms */
  exp: z.number().optional(),
  cachedAt: z.number(),
});

export type CachedTokenState = z.infer<typeof CachedTokenStateSchema>;

/**
 * Mock OBO JWT payload claims.
 * Aligns with mock-obo.md §2.1 Token structure.
 */
export const OboTokenPayloadSchema = z.object({
  iss: z.string(),
  sub: z.string(),
  aud: z.string().optional(),
  /** Tenant as string in JWT (external contract); app layer uses number INT(10) */
  tenant_id: z.string(),
  scope: z.string(),
  iat: z.number(),
  exp: z.number(),
  nbf: z.number(),
  jti: z.string(),
  act: z.object({ sub: z.string() }),
  _mock: z.boolean().optional(),
  _origin_user_token_sha256_prefix: z.string().optional(),
});

export type OboTokenPayload = z.infer<typeof OboTokenPayloadSchema>;

/**
 * Result of a successful OBO token exchange.
 * ref: mock-obo.md §1 OboProvider interface
 */
export const ExchangedTokenSchema = z.object({
  token: z.string(),
  issuer: z.string(),
  audience: z.string().optional(),
  scope: z.array(z.string()),
  /** epoch ms */
  expiresAt: z.number(),
  source: z.enum(['mock', 'real']),
  kid: z.string(),
  cached: z.boolean(),
});

export type ExchangedToken = z.infer<typeof ExchangedTokenSchema>;

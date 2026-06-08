/**
 * Grant entity contracts.
 *
 * Ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md §7 DDL
 *      docs/detailed-design/04-auth-and-authz/grant-lifecycle.md §2
 *      docs/adr/ADR-0011-user-grant-model.md
 *      docs/adr/ADR-0013-grant-args-constraint-dsl.md
 */
import { z } from 'zod';

/** G_A / G_B / G_D — G_C is Redis-only, not persisted */
export const GrantFormSchema = z.enum(['G_A', 'G_B', 'G_D']);
export type GrantForm = z.infer<typeof GrantFormSchema>;

/** ALLOW / DENY; DENY is only valid for G_A */
export const GrantScopeActionSchema = z.enum(['ALLOW', 'DENY']);
export type GrantScopeAction = z.infer<typeof GrantScopeActionSchema>;

/** Grant origin for audit differentiation */
export const GrantOriginSchema = z.enum([
  'USER_CENTER',
  'ADMIN_POLICY',
  'SESSION_UPGRADE',
]);
export type GrantOrigin = z.infer<typeof GrantOriginSchema>;

/** Grantor type */
export const GrantorTypeSchema = z.enum(['ADMIN', 'USER']);
export type GrantorType = z.infer<typeof GrantorTypeSchema>;

/**
 * Args constraint DSL envelope — jsonpath-v1 subset.
 * ref: authorization-gateway.md §5 / ADR-0013
 */
export const ArgsConstraintMatchSchema = z.object({
  path: z.string(),
  op: z.enum(['eq', 'ne', 'in', 'nin', 'eqCtx', 'neCtx']),
  value: z.unknown().optional(),
  ctx: z.enum([
    'principal.userId',
    'principal.tenant',
    'session.agentId',
    'session.sessionId',
  ]).optional(),
});

export const ArgsConstraintSchema = z.object({
  version: z.literal('jsonpath-v1'),
  all: z.boolean().default(true),
  matches: z.array(ArgsConstraintMatchSchema),
});

export type ArgsConstraint = z.infer<typeof ArgsConstraintSchema>;

/** Grant scope — tool name XOR tool pattern */
export const GrantScopeSchema = z.object({
  /** Exact tool name — mutually exclusive with toolPattern */
  toolName: z.string().optional(),
  /** Prefix wildcard ending in .* e.g. "platform.*" — mutually exclusive with toolName */
  toolPattern: z.string().optional(),
  action: GrantScopeActionSchema,
  argsConstraintJson: ArgsConstraintSchema.optional(),
}).refine(
  s => Boolean(s.toolName) !== Boolean(s.toolPattern),
  { message: 'Exactly one of toolName or toolPattern must be set (INVALID_ARGUMENT_GRANT_SCOPE)' },
);

export type GrantScope = z.infer<typeof GrantScopeSchema>;

/** Grant subject — who is granted */
export const GrantSubjectSchema = z.object({
  userId: z.string().optional(),
  /** M1 — ignored in matching, stored for future M2 group support */
  userGroupId: z.string().optional(),
  agentId: z.string().optional(),
  sessionId: z.string().optional(),
});

export type GrantSubject = z.infer<typeof GrantSubjectSchema>;

/**
 * Full Grant record (app-layer camelCase).
 * Corresponds to grants table row (SFID id, INT(10) tenant, soft-delete).
 * ref: authorization-gateway.md §7.2 DDL
 */
export const GrantSchema = z.object({
  /** SFID string representation of BIGINT(20) */
  id: z.string(),
  /** INT(10) */
  tenant: z.number().int().positive(),
  form: GrantFormSchema,
  grantorType: GrantorTypeSchema,
  grantorUserId: z.string().optional(),
  subject: GrantSubjectSchema,
  scope: GrantScopeSchema,
  origin: GrantOriginSchema,
  note: z.string().max(255).optional(),
  /** NULL = permanent */
  expireTime: z.number().optional(),
  revokeTime: z.number().optional(),
  revokeUserId: z.string().optional(),
  /** Soft-delete: 0 = active, epoch-ms = deleted */
  deleted: z.number().default(0),
  createTime: z.number(),
  updateTime: z.number(),
});

export type Grant = z.infer<typeof GrantSchema>;

/**
 * Ephemeral G_C grant stored in Redis (session-scoped, one-shot).
 * Key: agentic:engine:authz:grants:session:{sessionId}  HASH  field=<grantId>
 * ref: authorization-gateway.md §7.5
 */
export const SessionGrantSchema = z.object({
  form: z.literal('G_C'),
  scope: GrantScopeSchema,
  argsConstraintJson: ArgsConstraintSchema.optional(),
  createTime: z.number(),
  /** Non-null when consumed */
  consumeTime: z.number().optional(),
  oneShot: z.literal(true),
});

export type SessionGrant = z.infer<typeof SessionGrantSchema>;

/**
 * AuthZ decision request DTO.
 * ref: authorization-gateway.md §3.1
 */
export const ConsentPolicySchema = z.enum([
  'NEVER',
  'ON_FIRST_USE',
  'EACH_CALL',
  'ADMIN_ONLY',
]);
export type ConsentPolicy = z.infer<typeof ConsentPolicySchema>;

export const AuthzRequestSchema = z.object({
  tenant: z.number().int().positive(),
  userId: z.string(),
  sessionId: z.string().optional(),
  turnId: z.string().optional(),
  agentId: z.string().optional(),
  toolName: z.string(),
  args: z.unknown(),
  consentPolicy: ConsentPolicySchema,
  /** When set, must equal `tenant` or cross-tenant authorization is denied. */
  toolTenant: z.number().int().positive().optional(),
});

export type AuthzRequest = z.infer<typeof AuthzRequestSchema>;

/**
 * AuthZ decision result DTO.
 * ref: authorization-gateway.md §3.2
 */
export const AuthzDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('ALLOW'),
    reason: z.string(),
    grantId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('DENY'),
    reason: z.string(),
    violatedGrantId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('REQUIRE_CONSENT'),
    reason: z.string(),
    scopeHint: z.enum(['ONCE', 'PERSISTENT']),
  }),
]);

export type AuthzDecision = z.infer<typeof AuthzDecisionSchema>;

/** Grant state for state-machine transitions */
export const GrantStateSchema = z.enum(['PENDING', 'GRANTED', 'REVOKED', 'EXPIRED']);
export type GrantState = z.infer<typeof GrantStateSchema>;

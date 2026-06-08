import { z } from 'zod';
import { SfidSchema } from '../common/ids';
import { EpochMsSchema } from '../common/time';
import { AuditFieldsSchema } from '../common/audit';

/**
 * Zod schema for the `grants` (user_grant) table row.
 *
 * Aligned with:
 *   docs/detailed-design/04-auth-and-authz/authorization-gateway.md
 *   (Grant DDL is authoritative there; this schema mirrors it for contract use)
 *
 * Note: This is a read-only contract for P1-03 consumers (P1-05 owns the full grant BC).
 * P1-05 may extend this schema — cross-BC read only.
 *
 * Grant types (ADR-0011):
 *   G-A: platform admin grant (tenant-wide)
 *   G-B: user persistent grant (user-level, DB-backed)
 *   G-C: session-scoped grant (Redis only, not in this table)
 *   G-D: single-call grant (ephemeral, not persisted)
 */
export const GrantTypeSchema = z.enum(['G_A', 'G_B']);
export type GrantType = z.infer<typeof GrantTypeSchema>;

export const GrantStatusSchema = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
export type GrantStatus = z.infer<typeof GrantStatusSchema>;

export const UserGrantRowSchema = AuditFieldsSchema.extend({
  id:                   SfidSchema,
  userId:               z.string().max(64).nullable(),
  agentId:              SfidSchema.nullable(),
  toolRef:              z.string().max(128),
  grantType:            GrantTypeSchema,
  status:               GrantStatusSchema,
  /**
   * args_constraint — JSONPath v1 DSL (ADR-0013).
   * Null = no constraint (unconditional grant).
   */
  argsConstraintJson:   z.unknown().nullable(),
  expireTime:           EpochMsSchema.nullable(),
});

export type UserGrantRow = z.infer<typeof UserGrantRowSchema>;

import { z } from 'zod';

/**
 * Tenant identifier schema.
 *
 * DB column: `tenant INT(10) NOT NULL` — NOT `tenant_id` / `project_id`.
 * Application layer: `number` (safe INT(10) range, no BigInt needed).
 *
 * This schema is used internally by the engine; it MUST NOT appear in
 * public-facing DTOs (regulation §API-4: tenant is server-side derived from
 * the AuthContext, never from client input).
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §2.2
 *      docs/technical-design/phase-1/P1-01-foundations.md §3.4
 */
export const TenantSchema = z
  .number()
  .int()
  .nonnegative()
  .max(2_147_483_647, 'Tenant ID must be within INT(10) range');

export type TenantId = z.infer<typeof TenantSchema>;
/** Backwards-compatible alias used by P1-03 data layer. */
export type Tenant = TenantId;

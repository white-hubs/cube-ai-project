import { AgenticEngineError } from '../errors/agentic-error';
import { ISOLATION_MATRIX, readPath } from './isolation-matrix';

/**
 * assertResourceBelongsTenant — validates that a given resource object
 * carries the expected tenant value at the configured path.
 *
 * Throws:
 *  - AgenticEngineError('PERMISSION_DENIED_TENANT_MISMATCH') if tenants differ
 *  - AgenticEngineError('INTERNAL_ISOLATION_MATRIX_MISS') if resourceType unknown
 *  - AgenticEngineError('INTERNAL_INVARIANT_VIOLATION') if tenant field missing
 *
 * ref: tenant-isolation-matrix.md §3.5 TenantAwareRepository
 * ref: P1-12 design doc §3.5 / §5.2
 *
 * Design decision: error messages do NOT reveal the actual tenant value
 * of the resource (SEC4 §1.2 — "not transparent about mismatch direction").
 */
export function assertResourceBelongsTenant(
  resourceType: string,
  resource: Record<string, unknown>,
  tenant: number,
): void {
  const entry = ISOLATION_MATRIX[resourceType];
  if (entry === undefined) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_ISOLATION_MATRIX_MISS',
      `INTERNAL_ISOLATION_MATRIX_MISS: unknown resource type '${resourceType}'`,
      { resourceType },
    );
  }

  // Check if system tenant (tenant=0) is being used for a resource that forbids it
  if (tenant === 0 && !entry.allowSystemTenant) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_TENANT',
      `INVALID_ARGUMENT_TENANT: system tenant (tenant=0) not allowed for resource type '${resourceType}'`,
      { resourceType },
    );
  }

  const actualTenant = readPath(resource, entry.tenantPath);

  if (actualTenant === undefined || actualTenant === null) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_INVARIANT_VIOLATION',
      `INTERNAL_INVARIANT_VIOLATION: resource '${resourceType}' missing tenant field at path '${entry.tenantPath}'`,
      { resourceType, tenantPath: entry.tenantPath },
    );
  }

  if (actualTenant !== tenant) {
    // Deliberately vague — do not reveal actual tenant value (SEC4 §1.2)
    throw AgenticEngineError.fromCode(
      'PERMISSION_DENIED_TENANT_MISMATCH',
      'PERMISSION_DENIED_TENANT_MISMATCH: permission denied',
      // details purposefully minimal — no actual/expected leak to caller
      { resourceType },
    );
  }
}

/**
 * assertTenantFormat — validates that a tenant value is a valid INT(10)
 * unsigned integer. Does NOT allow tenant=0 for business operations.
 *
 * ref: tenant-isolation-matrix.md §3.5 assertCtxTenant
 */
export function assertTenantFormat(
  tenant: unknown,
  allowSystem = false,
): void {
  if (
    typeof tenant !== 'number' ||
    !Number.isInteger(tenant) ||
    tenant < 0 ||
    tenant > 4_294_967_295
  ) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_TENANT',
      'INVALID_ARGUMENT_TENANT: invalid tenant format: must be INT(10) unsigned integer',
      { tenant },
    );
  }
  if (tenant === 0 && !allowSystem) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_TENANT',
      'INVALID_ARGUMENT_TENANT: system tenant (tenant=0) not allowed for business operations',
      {},
    );
  }
}

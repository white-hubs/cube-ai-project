/**
 * ISOLATION_MATRIX — maps resource type to the expected tenant field path
 * and the storage layer it lives in.
 *
 * ref: tenant-isolation-matrix.md §2 data-layer overview + §3-§5
 * ref: P1-12 design doc §5.2
 *
 * Rules (SEC4 §1.1):
 * 1. Every row / key / vector / event / job MUST carry tenant INT(10)
 * 2. Read/write/delete MUST filter by tenant; this matrix is the authority
 *    for which path to read on a given resource object.
 *
 * Adding new entries:
 * 1. Add a new key below
 * 2. Update this file's unit test (isolation-matrix.test.ts) to include it
 * 3. Reference the M1 document section where the resource is defined
 */

export type StorageLayer = 'mysql' | 'redis' | 'qdrant' | 'bullmq' | 'outbox';

export interface IsolationMatrixEntry {
  /** dot-separated path to read the tenant value from a resource object */
  tenantPath: string;
  storage: StorageLayer;
  /** Whether tenant=0 is allowed for this resource (system objects) */
  allowSystemTenant?: boolean;
}

/**
 * Isolation matrix.
 * tenantPath uses dot-notation; array index access not supported in v1.
 *
 * ref per entry:
 * - mysql resources: tenant-isolation-matrix.md §3.2 table
 * - redis resources: tenant-isolation-matrix.md §4.2 + §4.3
 * - qdrant resources: tenant-isolation-matrix.md §5.1
 * - bullmq jobs:     tenant-isolation-matrix.md §4.4
 */
export const ISOLATION_MATRIX: Record<string, IsolationMatrixEntry> = {
  // MySQL resources
  session: { tenantPath: 'tenant', storage: 'mysql' },
  turn: { tenantPath: 'tenant', storage: 'mysql' },
  message: { tenantPath: 'tenant', storage: 'mysql' },
  user_grant: { tenantPath: 'tenant', storage: 'mysql' },
  job: { tenantPath: 'tenant', storage: 'mysql' },
  outbox_event: { tenantPath: 'tenant', storage: 'outbox' },
  usage_event: { tenantPath: 'tenant', storage: 'mysql' },
  audit_event: {
    tenantPath: 'tenant',
    storage: 'mysql',
    allowSystemTenant: true, // tenant=0 allowed for system events
  },
  descriptor: {
    tenantPath: 'tenant',
    storage: 'mysql',
    allowSystemTenant: true, // tenant=0 for built-in descriptors
  },

  // Redis resources (key-level isolation; tenantPath = the field in the parsed value)
  // ref: tenant-isolation-matrix.md §4.2 key family table
  'redis:authz_grant': { tenantPath: 'tenant', storage: 'redis' },
  'redis:session_idempotency': { tenantPath: 'tenant', storage: 'redis' },
  'redis:ratelimit': { tenantPath: 'tenant', storage: 'redis' },

  // Qdrant vector resources — single collection, payload filter
  // ref: tenant-isolation-matrix.md §5.1
  'qdrant:vector': { tenantPath: 'payload.tenant', storage: 'qdrant' },

  // BullMQ job payload
  // ref: tenant-isolation-matrix.md §4.4
  'bullmq:job': { tenantPath: 'tenant', storage: 'bullmq' },
};

/**
 * Reads a dot-separated path from a nested object.
 * Returns `undefined` if any segment is missing or null.
 */
export function readPath(
  obj: Record<string, unknown>,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

import { currentTenantId, isGlobalAccessEnabled } from '@cube-ai/server-shared'

export function requireScopedTenantId(errorFactory: () => Error): string {
  const tid = currentTenantId()
  if (!tid) throw errorFactory()
  return tid
}

/** @deprecated Use {@link requireScopedTenantId} */
export function requireScopedProjectId(errorFactory: () => Error): string {
  return requireScopedTenantId(errorFactory)
}

export { currentTenantId, isGlobalAccessEnabled }

import { currentTenantId, isGlobalAccessEnabled } from '@cube-ai/server-shared'

export function requireScopedTenantId(errorFactory: () => Error): string {
  const tid = currentTenantId()
  if (!tid) throw errorFactory()
  return tid
}


export { currentTenantId, isGlobalAccessEnabled }

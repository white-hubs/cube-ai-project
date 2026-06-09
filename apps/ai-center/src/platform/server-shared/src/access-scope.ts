import { tenantContextAls } from './tenant-context'

export function currentTenantId(): string | null {
  const raw = tenantContextAls.getStore()?.tenantId?.trim() ?? ''
  return raw !== '' ? raw : null
}

export function isGlobalAccessEnabled(): boolean {
  return tenantContextAls.getStore()?.bypassTenantIsolation === true
}

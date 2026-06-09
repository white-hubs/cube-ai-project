import { AsyncLocalStorage } from 'node:async_hooks';

export type TenantContext = {
  tenantId: string;
  bypassTenantIsolation?: boolean;
};

export const tenantContextAls = new AsyncLocalStorage<TenantContext>();

export function currentTenantId(): string | null {
  const raw = tenantContextAls.getStore()?.tenantId?.trim() ?? '';
  return raw !== '' ? raw : null;
}

export function isGlobalAccessEnabled(): boolean {
  return tenantContextAls.getStore()?.bypassTenantIsolation === true;
}

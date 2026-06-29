import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  tenantId: string;
  /** 为 true 时允许查询链路跳过 tenant 过滤，供超管全局视图使用。 */
  bypassTenantIsolation?: boolean;
}

/** 当前请求关联的 tenant（来自 JWT/鉴权中间件注入）。 */
export const tenantContextAls = new AsyncLocalStorage<TenantContext>();

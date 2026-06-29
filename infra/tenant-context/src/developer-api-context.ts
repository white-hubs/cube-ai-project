import { AsyncLocalStorage } from "node:async_hooks";

export type DeveloperApiAccessLevel = "tenant" | "system";

export interface DeveloperApiContext {
  apiKeyId: string;
  /** 密钥绑定流程；null 表示不限定 */
  flowIdScope: string | null;
  /** 密钥访问级别：租户级或系统级。 */
  accessLevel: DeveloperApiAccessLevel;
  /** 密钥绑定的租户（来自 api_keys.project_id）；系统级密钥为 null。 */
  tenantId: string | null;
}

export const developerApiAls = new AsyncLocalStorage<DeveloperApiContext>();

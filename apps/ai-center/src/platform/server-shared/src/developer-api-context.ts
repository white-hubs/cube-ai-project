import { AsyncLocalStorage } from 'node:async_hooks'

export type DeveloperApiAccessLevel = 'project' | 'system'

export type DeveloperApiContext = {
  apiKeyId: string
  /** 密钥绑定流程；null 表示不限定 */
  flowIdScope: string | null
  /** 仅允许的工具名（来自 api_keys.allowed_tools_json）；null/空 表示不限制 */
  allowedTools: string[] | null
  /** 密钥访问级别：项目级或系统级。 */
  accessLevel: DeveloperApiAccessLevel
  /** 密钥绑定的租户（来自 api_keys.project_id）；系统级密钥为 null。 */
  tenantId: string | null
}

export const developerApiAls = new AsyncLocalStorage<DeveloperApiContext>()

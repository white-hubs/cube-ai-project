/**
 * Server 子包间复用、不暴露给 web 的轻量工具。
 * 随重组逐步迁入具体实现；见 cube-ai/server/README.md。
 *
 * 租户 ALS 原语已迁至 @cube-ai/tenant-context，此处保留 re-export 保持零破坏。
 */
export {
  tenantContextAls,
  type TenantContext,
  currentTenantId,
  isGlobalAccessEnabled,
  developerApiAls,
  type DeveloperApiContext,
  type DeveloperApiAccessLevel,
} from '@cube-ai/tenant-context'
export { authenticatedUserAls, type AuthenticatedUserContext } from './auth-context'

export function assertNonEmptyString(value: string, name: string): string {
  const t = value.trim()
  if (!t) throw new Error(`${name} is required`)
  return t
}

/**
 * Server 子包间复用、不暴露给 web 的轻量工具。
 * 随重组逐步迁入具体实现；见 cube-ai/server/README.md。
 */
export {
  tenantContextAls,
  type TenantContext,
} from './tenant-context'
export { authenticatedUserAls, type AuthenticatedUserContext } from './auth-context'
export { developerApiAls, type DeveloperApiContext } from './developer-api-context'
export { currentTenantId, isGlobalAccessEnabled } from './access-scope'

export function assertNonEmptyString(value: string, name: string): string {
  const t = value.trim()
  if (!t) throw new Error(`${name} is required`)
  return t
}

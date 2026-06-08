import { currentProjectId, isGlobalAccessEnabled } from '@cube-ai/server-shared'

export function requireScopedProjectId(errorFactory: () => Error): string {
  const pid = currentProjectId()
  if (!pid) throw errorFactory()
  return pid
}

export { currentProjectId, isGlobalAccessEnabled }

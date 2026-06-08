import { projectContextAls } from './project-context'

export function currentProjectId(): string | null {
  const raw = projectContextAls.getStore()?.projectId?.trim() ?? ''
  return raw !== '' ? raw : null
}

export function isGlobalAccessEnabled(): boolean {
  return projectContextAls.getStore()?.bypassProjectIsolation === true
}

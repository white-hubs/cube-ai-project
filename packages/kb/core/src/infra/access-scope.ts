import { AsyncLocalStorage } from 'node:async_hooks';

export type ProjectContext = {
  projectId: string;
  bypassProjectIsolation?: boolean;
};

export const projectContextAls = new AsyncLocalStorage<ProjectContext>();

export function currentProjectId(): string | null {
  const raw = projectContextAls.getStore()?.projectId?.trim() ?? '';
  return raw !== '' ? raw : null;
}

export function isGlobalAccessEnabled(): boolean {
  return projectContextAls.getStore()?.bypassProjectIsolation === true;
}

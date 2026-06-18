import type { DualSubject } from '@cube-ai/contracts';

export const SESSION_ADMIN_SCOPE = 'engine.session.admin';

export function isSessionAdmin(subject: DualSubject): boolean {
  return subject.user.scopes.includes(SESSION_ADMIN_SCOPE);
}

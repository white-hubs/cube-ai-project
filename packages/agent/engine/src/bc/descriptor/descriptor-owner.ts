import type { DualSubject } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';

export const DESCRIPTOR_ADMIN_SCOPE = 'engine.descriptor.admin';

export function isDescriptorAdmin(subject: DualSubject): boolean {
  return subject.user.scopes.includes(DESCRIPTOR_ADMIN_SCOPE);
}

function denied(ownerUserId: string | null, userId: string): never {
  throw AgenticEngineError.fromCode(
    'PERMISSION_DENIED_DESCRIPTOR_OWNER',
    'Descriptor write is allowed only for the owner',
    { ownerUserId, userId },
  );
}

export function assertDescriptorOwner(ownerUserId: string | null, userId?: string): void {
  if (ownerUserId && userId === ownerUserId) return;
  denied(ownerUserId, userId ?? '');
}

export function assertDescriptorOwnerOrAdmin(
  ownerUserId: string | null,
  userId: string | undefined,
  isAdmin: boolean,
): void {
  if (isAdmin) return;
  assertDescriptorOwner(ownerUserId, userId);
}

import type { KnowledgeFeedbackAuthContext } from "@cube-ai/contracts/platform";

export class FeedbackUnauthorizedError extends Error {
  public readonly code = "FEEDBACK_UNAUTHORIZED" as const;

  public constructor(message: string) {
    super(message);
    this.name = "FeedbackUnauthorizedError";
  }
}

/**
 * W4.2-H2 — reject anonymous / unscoped feedback writes (and reads by trace).
 * Tenant must be present; authentication must already have been verified by the host.
 */
export function assertFeedbackAuthorized(auth: KnowledgeFeedbackAuthContext): asserts auth is KnowledgeFeedbackAuthContext & {
  tenantId: string;
} {
  const tenantId = typeof auth.tenantId === "string" ? auth.tenantId.trim() : "";
  if (!tenantId) {
    throw new FeedbackUnauthorizedError("tenant is required for search feedback");
  }
  if (!auth.authenticated) {
    throw new FeedbackUnauthorizedError("authentication required for search feedback");
  }
  (auth as { tenantId: string }).tenantId = tenantId;
}

export function resolveFeedbackAuthFromTrustedContext(input: {
  tenantId: string | null | undefined;
  /** Subject projected by a verified host/port context, never parsed from raw headers. */
  trustedSubjectId?: string | null;
}): KnowledgeFeedbackAuthContext {
  const trusted = Boolean(input.trustedSubjectId?.trim());
  return {
    authenticated: trusted,
    ...(trusted ? { subjectId: input.trustedSubjectId!.trim() } : {}),
    tenantId: input.tenantId,
  };
}

import type { Context, Middleware, NextFunction } from "@dangao/bun-server";

import { authenticatedUserAls } from "@cube-ai/ai-center/platform/server-shared";

/**
 * Bridges the ghcloud-authenticated principal (carried in `authenticatedUserAls`,
 * populated by {@link createExecutionAuthMiddleware}) into `ctx.state.subject.user`.
 *
 * Engine BCs (Session / Turn / Grant) own resources under `ctx.state.subject.user.userId`
 * — a DualSubject written upstream by `oauth2IntrospectionMiddleware`. In `mock` auth mode
 * that placeholder is `mock-user`, so without this bridge every session is attributed to a
 * single fake user. This middleware overwrites the user identity with the real platform
 * principal while preserving tenant / scopes / trace already resolved upstream.
 *
 * No-op when no authenticated user is present (e.g. developer-API-key flows).
 *
 * Ordering: must run AFTER `createExecutionAuthMiddleware` so the ALS is established.
 */
export function createSubjectUserBridgeMiddleware(): Middleware {
  return async (ctx: Context, next: NextFunction) => {
    const user = authenticatedUserAls.getStore();
    if (user) {
      const state = (
        ctx as unknown as {
          state?: { subject?: { user?: Record<string, unknown> } };
        }
      ).state;
      const subject = state?.subject;
      if (subject?.user) {
        subject.user = {
          ...subject.user,
          displayName: user.username,
          userId: user.userId,
        };
      }
    }
    return next();
  };
}

/**
 * Grant-Expire Processor — periodic scan for time-expired grants (revoke_time path).
 *
 * DB authority: authorization-gateway.md §7 — expiry uses `expire_time < NOW`
 * and sets `revoke_time` (no separate status column).
 *
 * ref: P3-09 §3.5 / grant-lifecycle.md
 */
import type { JobDataService } from '../job-data.service';
import type { GrantService } from '../../authz/grant.service';

export const GRANT_EXPIRE_JOB_NAME = 'grant-expire' as const;

/** BullMQ repeatable interval alternative (when not using cron parser) — informational */
export const GRANT_EXPIRE_REPEAT_EVERY_MS = 60_000;

export interface GrantExpireProcessorDeps {
  jobData: JobDataService;
  grantService: GrantService;
}

export async function runGrantExpireProcessor(
  _data: unknown,
  deps: GrantExpireProcessorDeps,
): Promise<{ ok: boolean }> {
  const candidates = await deps.jobData.selectGrantsExpiredBeforeNow();
  if (candidates.length === 0) return { ok: true };

  const ids = candidates.map((c) => c.id);
  await deps.jobData.markGrantsExpired(ids);

  const seen = new Set<string>();
  for (const c of candidates) {
    if (c.subjectUserId) {
      const key = `${c.tenant}:${c.subjectUserId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.grantService.notifyGrantsExpiredForUser(c.tenant, c.subjectUserId);
    }
  }

  return { ok: true };
}

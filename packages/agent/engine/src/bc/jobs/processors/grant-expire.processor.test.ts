import { describe, it, expect, mock } from 'bun:test';
import type { JobDataService } from '../job-data.service';
import type { GrantService } from '../../authz/grant.service';
import { runGrantExpireProcessor } from './grant-expire.processor';

describe('runGrantExpireProcessor', () => {
  it('no candidates — ok', async () => {
    const jobData = {
      selectGrantsExpiredBeforeNow: mock(async () => []),
      markGrantsExpired: mock(async () => 0),
    } as unknown as JobDataService;
    const grantService = {
      notifyGrantsExpiredForUser: mock(() => {}),
    } as unknown as GrantService;

    const r = await runGrantExpireProcessor({}, { jobData, grantService });
    expect(r.ok).toBe(true);
    expect(grantService.notifyGrantsExpiredForUser).not.toHaveBeenCalled();
  });

  it('expires batch and notifies users', async () => {
    const jobData = {
      selectGrantsExpiredBeforeNow: mock(async () => [
        { id: '8234567890123456789', tenant: 1, subjectUserId: 'alice' },
        { id: '9234567890123456789', tenant: 1, subjectUserId: 'alice' },
      ]),
      markGrantsExpired: mock(async () => 2),
    } as unknown as JobDataService;
    const notify = mock(() => {});
    const grantService = {
      notifyGrantsExpiredForUser: notify,
    } as unknown as GrantService;

    const r = await runGrantExpireProcessor({}, { jobData, grantService });
    expect(r.ok).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(1, 'alice');
  });

  it('dedupes tenant+user pairs', async () => {
    const jobData = {
      selectGrantsExpiredBeforeNow: mock(async () => [
        { id: '1111111111111111111', tenant: 2, subjectUserId: 'bob' },
        { id: '2222222222222222222', tenant: 2, subjectUserId: 'bob' },
      ]),
      markGrantsExpired: mock(async () => 2),
    } as unknown as JobDataService;
    const notify = mock(() => {});
    const grantService = { notifyGrantsExpiredForUser: notify } as unknown as GrantService;

    await runGrantExpireProcessor({}, { jobData, grantService });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

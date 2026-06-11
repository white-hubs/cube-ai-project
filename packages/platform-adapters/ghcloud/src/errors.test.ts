import { describe, expect, it } from 'bun:test';
import { GhcloudPlatformError } from './errors';

describe('GhcloudPlatformError', () => {
  it('fromCode preserves code, message and details', () => {
    const err = GhcloudPlatformError.fromCode('UPSTREAM_AUTH_FAILED', 'denied', {
      status: 401,
      body: { message: 'nope' },
    });
    expect(err).toBeInstanceOf(GhcloudPlatformError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GhcloudPlatformError');
    expect(err.code).toBe('UPSTREAM_AUTH_FAILED');
    expect(err.message).toBe('denied');
    expect(err.details).toEqual({ status: 401, body: { message: 'nope' } });
  });

  it('details is undefined when omitted', () => {
    const err = GhcloudPlatformError.fromCode('UPSTREAM_NETWORK_TIMEOUT', 'timeout');
    expect(err.details).toBeUndefined();
  });
});

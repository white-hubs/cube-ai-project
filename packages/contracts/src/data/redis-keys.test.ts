import { describe, test, expect } from 'bun:test';
import { RedisKeys, REDIS_KEY_ROOT } from './redis-keys';

/**
 * Unit tests for Redis key generators.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/02-data/redis-keys.md §2
 */

describe('RedisKeys — all keys must start with agentic:engine:', () => {
  const PREFIX = 'agentic:engine:';

  const allGeneratedKeys = [
    RedisKeys.authIntrospect('abc123'),
    RedisKeys.authIntrospectFail('abc123'),
    RedisKeys.authJwks(),
    RedisKeys.authObo('u_abc', 1001, 'f1e2d3c4', 'https://auth.example.com'),
    RedisKeys.authzGrant(1001, '1234567890123456789'),
    RedisKeys.authzGrantsSession('1234567890123456789'),
    RedisKeys.authzGrantsUser(1001, 'u_abc'),
    RedisKeys.authzGrantsAdmin(1001),
    RedisKeys.authzGrantActiveTool(1001, 'u_abc', 'platform.api.invoke'),
    RedisKeys.authzGrantRequest('1234567890123456789'),
    RedisKeys.sessionTurnLock('1234567890123456789'),
    RedisKeys.sessionSseBuffer('1234567890123456789'),
    RedisKeys.sessionSseConn('1234567890123456789'),
    RedisKeys.sessionIdempotency(1001, 'my-idempotency-key'),
    RedisKeys.sessionAbort('1234567890123456789'),
    RedisKeys.sessionLifecycle('1234567890123456789'),
    RedisKeys.ackTool('1234567890123456789'),
    RedisKeys.ackGrant('1234567890123456789'),
    RedisKeys.outboxRelayCursor('usage_bus'),
    RedisKeys.outboxRelayLeader(),
    RedisKeys.pubsubDescriptorReload(),
    RedisKeys.pubsubGrantInvalidate(),
    RedisKeys.pubsubSessionLifecycle(),
    RedisKeys.pubsubConfigReload(),
  ];

  test('all generated keys start with agentic:engine:', () => {
    for (const key of allGeneratedKeys) {
      expect(key).toMatch(new RegExp(`^${PREFIX}`));
    }
  });

  test('REDIS_KEY_ROOT is agentic:engine', () => {
    expect(REDIS_KEY_ROOT).toBe('agentic:engine');
  });

  test('session turn lock key has correct structure', () => {
    const key = RedisKeys.sessionTurnLock('1234567890123456789');
    expect(key).toBe('agentic:engine:session:turn:lock:1234567890123456789');
  });

  test('session SSE buffer key has correct structure', () => {
    const key = RedisKeys.sessionSseBuffer('9999999999999999999');
    expect(key).toBe('agentic:engine:session:sse:buffer:9999999999999999999');
  });

  test('outbox relay leader key has correct structure', () => {
    const key = RedisKeys.outboxRelayLeader();
    expect(key).toBe('agentic:engine:outbox:relay:leader');
  });

  test('pubsub channels have dot-notation format (not colon)', () => {
    expect(RedisKeys.pubsubDescriptorReload()).toContain('descriptor.reload');
    expect(RedisKeys.pubsubGrantInvalidate()).toContain('grant.invalidate');
    expect(RedisKeys.pubsubSessionLifecycle()).toContain('session.lifecycle');
  });

  test('no key uses snake_case in segments (use : as separator)', () => {
    for (const key of allGeneratedKeys) {
      // Key segments (after removing PubSub dot-notation) should not contain underscores
      // except in the dynamic parts (tenant, grantId etc.) and PubSub channel names
      const normalized = key.replace(/agentic:engine:/, '');
      // The domain prefix must not contain underscores
      const domain = normalized.split(':')[0];
      expect(domain).not.toContain('_');
    }
  });
});

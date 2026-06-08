import { describe, test, expect } from 'bun:test';
import {
  SessionOpenedEventSchema,
  SessionClosedEventSchema,
  SessionLifecycleEventSchema,
  TurnStartedOutboxEventSchema,
  TurnCancelledOutboxEventSchema,
  TurnLifecycleEventSchema,
} from './lifecycle-event';

/**
 * Unit tests for session lifecycle Outbox event schemas.
 * ref: P1-06 design doc §7
 *      docs/detailed-design/05-session/lifecycle.md §7
 */

const SFID = '1820000000000000656';
const NOW = Date.now();

describe('SessionOpenedEventSchema (session.created)', () => {
  test('parses valid session.created event', () => {
    const result = SessionOpenedEventSchema.safeParse({
      eventType: 'session.created',
      sessionId: SFID,
      createTime: NOW,
      agentId: SFID,
      agentVersionNo: 1,
      userId: 'user-123',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventType).toBe('session.created');
    }
  });

  test('rejects non-positive agentVersionNo', () => {
    expect(SessionOpenedEventSchema.safeParse({
      eventType: 'session.created',
      sessionId: SFID,
      createTime: NOW,
      agentId: SFID,
      agentVersionNo: 0,
      userId: 'u',
    }).success).toBe(false);
  });

  test('rejects userId exceeding 64 chars', () => {
    expect(SessionOpenedEventSchema.safeParse({
      eventType: 'session.created',
      sessionId: SFID,
      createTime: NOW,
      agentId: SFID,
      agentVersionNo: 1,
      userId: 'x'.repeat(65),
    }).success).toBe(false);
  });
});

describe('SessionClosedEventSchema (session.closed)', () => {
  test('parses valid session.closed event', () => {
    const result = SessionClosedEventSchema.safeParse({
      eventType: 'session.closed',
      sessionId: SFID,
      closeTime: NOW,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventType).toBe('session.closed');
    }
  });

  test('rejects negative closeTime', () => {
    expect(SessionClosedEventSchema.safeParse({
      eventType: 'session.closed',
      sessionId: SFID,
      closeTime: -1,
    }).success).toBe(false);
  });
});

describe('SessionLifecycleEventSchema discriminated union', () => {
  test('routes session.created correctly', () => {
    const result = SessionLifecycleEventSchema.safeParse({
      eventType: 'session.created',
      sessionId: SFID,
      createTime: NOW,
      agentId: SFID,
      agentVersionNo: 2,
      userId: 'usr_abc',
    });
    expect(result.success).toBe(true);
  });

  test('routes session.closed correctly', () => {
    expect(SessionLifecycleEventSchema.safeParse({
      eventType: 'session.closed',
      sessionId: SFID,
      closeTime: NOW,
    }).success).toBe(true);
  });

  test('rejects unknown eventType', () => {
    expect(SessionLifecycleEventSchema.safeParse({
      eventType: 'session.unknown',
      sessionId: SFID,
    }).success).toBe(false);
  });
});

describe('TurnStartedOutboxEventSchema', () => {
  test('parses valid turn.started event', () => {
    const result = TurnStartedOutboxEventSchema.safeParse({
      eventType: 'turn.started',
      turnId: SFID,
      sessionId: SFID,
      turnNo: 1,
      startTime: NOW,
    });
    expect(result.success).toBe(true);
  });
});

describe('TurnCancelledOutboxEventSchema', () => {
  test('parses valid turn.cancelled event with USER_REQUEST reason', () => {
    const result = TurnCancelledOutboxEventSchema.safeParse({
      eventType: 'turn.cancelled',
      turnId: SFID,
      reason: 'USER_REQUEST',
      closeTime: NOW,
    });
    expect(result.success).toBe(true);
  });

  test('rejects lowercase reason', () => {
    expect(TurnCancelledOutboxEventSchema.safeParse({
      eventType: 'turn.cancelled',
      turnId: SFID,
      reason: 'user_request',
      closeTime: NOW,
    }).success).toBe(false);
  });

  test('rejects unknown reason', () => {
    expect(TurnCancelledOutboxEventSchema.safeParse({
      eventType: 'turn.cancelled',
      turnId: SFID,
      reason: 'UNKNOWN_REASON',
      closeTime: NOW,
    }).success).toBe(false);
  });
});

describe('TurnLifecycleEventSchema', () => {
  test('routes all 4 turn event types', () => {
    const events = [
      { eventType: 'turn.started', turnId: SFID, sessionId: SFID, turnNo: 1, startTime: NOW },
      { eventType: 'turn.completed', turnId: SFID, closeTime: NOW, durationMs: 500 },
      { eventType: 'turn.cancelled', turnId: SFID, reason: 'TIMEOUT', closeTime: NOW },
      { eventType: 'turn.failed', turnId: SFID, errorCode: 'INTERNAL_UNKNOWN', closeTime: NOW },
    ];
    for (const ev of events) {
      expect(TurnLifecycleEventSchema.safeParse(ev).success).toBe(true);
    }
  });
});

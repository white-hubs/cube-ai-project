import { describe, expect, test } from "bun:test";

import {
  SessionClosedEventSchema,
  SessionLifecycleEventSchema,
  SessionOpenedEventSchema,
  TurnCancelledOutboxEventSchema,
  TurnLifecycleEventSchema,
  TurnStartedOutboxEventSchema,
} from "./lifecycle-event";

/**
 * Unit tests for session lifecycle Outbox event schemas.
 * ref: P1-06 design doc §7
 *      docs/detailed-design/05-session/lifecycle.md §7
 */

const SFID = "1820000000000000656";
const NOW = Date.now();

describe("SessionOpenedEventSchema (session.created)", () => {
  test("parses valid session.created event", () => {
    const result = SessionOpenedEventSchema.safeParse({
      agentId: SFID,
      agentVersionNo: 1,
      createTime: NOW,
      eventType: "session.created",
      sessionId: SFID,
      userId: "user-123",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventType).toBe("session.created");
    }
  });

  test("rejects non-positive agentVersionNo", () => {
    expect(
      SessionOpenedEventSchema.safeParse({
        agentId: SFID,
        agentVersionNo: 0,
        createTime: NOW,
        eventType: "session.created",
        sessionId: SFID,
        userId: "u",
      }).success,
    ).toBe(false);
  });

  test("rejects userId exceeding 64 chars", () => {
    expect(
      SessionOpenedEventSchema.safeParse({
        agentId: SFID,
        agentVersionNo: 1,
        createTime: NOW,
        eventType: "session.created",
        sessionId: SFID,
        userId: "x".repeat(65),
      }).success,
    ).toBe(false);
  });
});

describe("SessionClosedEventSchema (session.closed)", () => {
  test("parses valid session.closed event", () => {
    const result = SessionClosedEventSchema.safeParse({
      closeTime: NOW,
      eventType: "session.closed",
      sessionId: SFID,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.eventType).toBe("session.closed");
    }
  });

  test("rejects negative closeTime", () => {
    expect(
      SessionClosedEventSchema.safeParse({
        closeTime: -1,
        eventType: "session.closed",
        sessionId: SFID,
      }).success,
    ).toBe(false);
  });
});

describe("SessionLifecycleEventSchema discriminated union", () => {
  test("routes session.created correctly", () => {
    const result = SessionLifecycleEventSchema.safeParse({
      agentId: SFID,
      agentVersionNo: 2,
      createTime: NOW,
      eventType: "session.created",
      sessionId: SFID,
      userId: "usr_abc",
    });
    expect(result.success).toBe(true);
  });

  test("routes session.closed correctly", () => {
    expect(
      SessionLifecycleEventSchema.safeParse({
        closeTime: NOW,
        eventType: "session.closed",
        sessionId: SFID,
      }).success,
    ).toBe(true);
  });

  test("rejects unknown eventType", () => {
    expect(
      SessionLifecycleEventSchema.safeParse({
        eventType: "session.unknown",
        sessionId: SFID,
      }).success,
    ).toBe(false);
  });
});

describe("TurnStartedOutboxEventSchema", () => {
  test("parses valid turn.started event", () => {
    const result = TurnStartedOutboxEventSchema.safeParse({
      eventType: "turn.started",
      sessionId: SFID,
      startTime: NOW,
      turnId: SFID,
      turnNo: 1,
    });
    expect(result.success).toBe(true);
  });
});

describe("TurnCancelledOutboxEventSchema", () => {
  test("parses valid turn.cancelled event with USER_REQUEST reason", () => {
    const result = TurnCancelledOutboxEventSchema.safeParse({
      closeTime: NOW,
      eventType: "turn.cancelled",
      reason: "USER_REQUEST",
      turnId: SFID,
    });
    expect(result.success).toBe(true);
  });

  test("rejects lowercase reason", () => {
    expect(
      TurnCancelledOutboxEventSchema.safeParse({
        closeTime: NOW,
        eventType: "turn.cancelled",
        reason: "user_request",
        turnId: SFID,
      }).success,
    ).toBe(false);
  });

  test("rejects unknown reason", () => {
    expect(
      TurnCancelledOutboxEventSchema.safeParse({
        closeTime: NOW,
        eventType: "turn.cancelled",
        reason: "UNKNOWN_REASON",
        turnId: SFID,
      }).success,
    ).toBe(false);
  });
});

describe("TurnLifecycleEventSchema", () => {
  test("routes all 4 turn event types", () => {
    const events = [
      { eventType: "turn.started", sessionId: SFID, startTime: NOW, turnId: SFID, turnNo: 1 },
      { closeTime: NOW, durationMs: 500, eventType: "turn.completed", turnId: SFID },
      { closeTime: NOW, eventType: "turn.cancelled", reason: "TIMEOUT", turnId: SFID },
      { closeTime: NOW, errorCode: "INTERNAL_UNKNOWN", eventType: "turn.failed", turnId: SFID },
    ];
    for (const ev of events) {
      expect(TurnLifecycleEventSchema.safeParse(ev).success).toBe(true);
    }
  });
});

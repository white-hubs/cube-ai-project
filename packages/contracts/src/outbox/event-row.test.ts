import { describe, expect, test } from "bun:test";

import { AuditFieldsSchema } from "../common/audit";
import { OutboxChannelSchema, OutboxEventRowSchema } from "./event-row";

/**
 * Unit tests for OutboxEventRow schema.
 * Ref: docs/technical-design/phase-1/P1-03-data-outbox.md §7
 *      docs/detailed-design/06-jobs/README.md §4.1
 */

const BASE_AUDIT = {
  createBy: "system",
  createTime: Date.now(),
  creatorId: null,
  creatorType: null,
  deleted: 0,
  tenant: 1001,
  updateBy: "system",
  updateTime: Date.now(),
  updaterId: null,
  updaterType: null,
};

const VALID_ROW = {
  ...BASE_AUDIT,
  attempts: 0,
  channel: "usage_bus" as const,
  eventType: "usage.job_duration",
  id: "1234567890123456789",
  lastError: null,
  nextAttemptTime: null,
  payloadJson: { schema: "usage.job_duration.v1" },
  publishTime: null,
  scheduleTime: Date.now(),
  status: "PENDING" as const,
  target: null,
};

describe("OutboxEventRowSchema", () => {
  test("parses a valid row", () => {
    const result = OutboxEventRowSchema.safeParse(VALID_ROW);
    expect(result.success).toBe(true);
  });

  test("10 audit fields are all required", () => {
    const auditKeys = [
      "createBy",
      "creatorId",
      "creatorType",
      "createTime",
      "updateBy",
      "updaterId",
      "updaterType",
      "updateTime",
      "tenant",
      "deleted",
    ];
    expect(Object.keys(AuditFieldsSchema.shape)).toEqual(expect.arrayContaining(auditKeys));
    expect(Object.keys(AuditFieldsSchema.shape)).toHaveLength(10);
  });

  test("tenant must be non-negative integer (INT(10) range)", () => {
    const invalidTenant = { ...VALID_ROW, tenant: -1 };
    expect(OutboxEventRowSchema.safeParse(invalidTenant).success).toBe(false);

    const maxTenant = { ...VALID_ROW, tenant: 2_147_483_647 };
    expect(OutboxEventRowSchema.safeParse(maxTenant).success).toBe(true);

    const overflowTenant = { ...VALID_ROW, tenant: 2_147_483_648 };
    expect(OutboxEventRowSchema.safeParse(overflowTenant).success).toBe(false);
  });

  test("time fields use epoch ms (not null for required fields)", () => {
    // createTime and updateTime are EpochMs — must be non-negative integers
    const negativeTime = { ...VALID_ROW, createTime: -1 };
    expect(OutboxEventRowSchema.safeParse(negativeTime).success).toBe(false);
  });

  test("deleted is 0 for active rows, non-zero for deleted", () => {
    const active = { ...VALID_ROW, deleted: 0 };
    expect(OutboxEventRowSchema.safeParse(active).success).toBe(true);

    const deleted = { ...VALID_ROW, deleted: Date.now() };
    expect(OutboxEventRowSchema.safeParse(deleted).success).toBe(true);

    const invalidDeleted = { ...VALID_ROW, deleted: -1 };
    expect(OutboxEventRowSchema.safeParse(invalidDeleted).success).toBe(false);
  });

  test("status enum is closed set (PENDING/PUBLISHED/FAILED/DEAD)", () => {
    const validStatuses = ["PENDING", "PUBLISHED", "FAILED", "DEAD"];
    for (const status of validStatuses) {
      expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, status }).success).toBe(true);
    }
    expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, status: "pending" }).success).toBe(false);
    expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, status: "UNKNOWN" }).success).toBe(false);
  });

  test("channel enum is closed set (7 values)", () => {
    const validChannels = [
      "bullmq_job",
      "message_service",
      "usage_bus",
      "usage_event",
      "descriptor_reload",
      "authz_invalidate",
      "session_lifecycle",
    ];
    expect(OutboxChannelSchema.options).toHaveLength(7);
    for (const channel of validChannels) {
      expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, channel }).success).toBe(true);
    }
    expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, channel: "unknown_channel" }).success).toBe(false);
  });

  test("id must be SFID decimal string", () => {
    expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, id: "abc" }).success).toBe(false);
    expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, id: "" }).success).toBe(false);
    expect(OutboxEventRowSchema.safeParse({ ...VALID_ROW, id: "1234567890123456789" }).success).toBe(true);
  });
});

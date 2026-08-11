import { describe, expect, it } from "bun:test";

/**
 * Unit tests for contracts/src/jobs/job.ts and job-result.ts
 *
 * Ref: design doc §7 / shared-context §4.3
 */
import { BullMQJobPayloadSchema, JobKindSchema, JobPrincipalSnapshotSchema, JobQueueNameSchema, JobStatusSchema } from "./job";
import { JobErrorCodeSchema, JobResultSchema } from "./job-result";

// ─── JobStatusSchema ─────────────────────────────────────────────────────────

describe("JobStatusSchema", () => {
  it("accepts all valid statuses", () => {
    const statuses = ["QUEUED", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"];
    for (const s of statuses) {
      expect(() => JobStatusSchema.parse(s)).not.toThrow();
    }
  });

  it("rejects lowercase status", () => {
    expect(JobStatusSchema.safeParse("queued").success).toBe(false);
  });

  it("rejects unknown status", () => {
    expect(JobStatusSchema.safeParse("PENDING").success).toBe(false);
  });
});

// ─── JobKindSchema ────────────────────────────────────────────────────────────

describe("JobKindSchema", () => {
  it("accepts TOOL, CLEANUP, OUTBOX, MCP_DISCOVERY", () => {
    for (const k of ["TOOL", "CLEANUP", "OUTBOX", "MCP_DISCOVERY"]) {
      expect(() => JobKindSchema.parse(k)).not.toThrow();
    }
  });

  it("rejects lowercase kind", () => {
    expect(JobKindSchema.safeParse("tool").success).toBe(false);
  });
});

// ─── JobQueueNameSchema ───────────────────────────────────────────────────────

describe("JobQueueNameSchema", () => {
  it("accepts M1 active queue names", () => {
    expect(() => JobQueueNameSchema.parse("agentic-engine-long-running-jobs")).not.toThrow();
    expect(() => JobQueueNameSchema.parse("agentic-engine-cleanup")).not.toThrow();
    expect(() => JobQueueNameSchema.parse("agentic-kb-ingest")).not.toThrow();
    expect(() => JobQueueNameSchema.parse("agentic-kb-vector-reconcile")).not.toThrow();
  });

  it("rejects unknown queue name", () => {
    expect(JobQueueNameSchema.safeParse("engine-long-running-jobs").success).toBe(false);
  });

  it("rejects old-style queue name without agentic- prefix", () => {
    expect(JobQueueNameSchema.safeParse("long-running-jobs").success).toBe(false);
  });
});

// ─── BullMQJobPayloadSchema ───────────────────────────────────────────────────

describe("BullMQJobPayloadSchema", () => {
  const validPayload = {
    jobId: "12345678901234567",
    tenant: 1001,
    toolRef: "builtin:platform.flow.invoke",
  };

  it("accepts a valid minimal payload", () => {
    expect(() => BullMQJobPayloadSchema.parse(validPayload)).not.toThrow();
  });

  it("accepts payload without toolRef (cleanup jobs)", () => {
    const { toolRef: _, ...noToolRef } = validPayload;
    expect(() => BullMQJobPayloadSchema.parse(noToolRef)).not.toThrow();
  });

  it("rejects non-decimal jobId", () => {
    expect(BullMQJobPayloadSchema.safeParse({ ...validPayload, jobId: "job_abc123" }).success).toBe(false);
  });

  it("rejects negative tenant", () => {
    expect(BullMQJobPayloadSchema.safeParse({ ...validPayload, tenant: -1 }).success).toBe(false);
  });

  it("rejects zero tenant", () => {
    expect(BullMQJobPayloadSchema.safeParse({ ...validPayload, tenant: 0 }).success).toBe(false);
  });
});

// ─── JobResultSchema ─────────────────────────────────────────────────────────

describe("JobResultSchema", () => {
  const validCompleted = {
    endTime: new Date(),
    jobId: "12345678901234567",
    status: "COMPLETED",
  };

  const validFailed = {
    endTime: new Date(),
    errorCode: "JOB_MAX_ATTEMPTS_EXCEEDED",
    jobId: "12345678901234567",
    status: "FAILED",
  };

  it("accepts COMPLETED result without errorCode", () => {
    expect(() => JobResultSchema.parse(validCompleted)).not.toThrow();
  });

  it("accepts FAILED result with errorCode", () => {
    expect(() => JobResultSchema.parse(validFailed)).not.toThrow();
  });

  it("rejects FAILED result without errorCode", () => {
    const { errorCode: _, ...noErr } = validFailed;
    expect(JobResultSchema.safeParse(noErr).success).toBe(false);
  });

  it("rejects errorCode with lowercase letters", () => {
    expect(JobResultSchema.safeParse({ ...validFailed, errorCode: "job_failed" }).success).toBe(false);
  });
});

// ─── JobErrorCodeSchema ───────────────────────────────────────────────────────

describe("JobErrorCodeSchema", () => {
  it("contains all 10 job error codes from long-running-runtime §10", () => {
    const expectedCodes = [
      "JOB_NOT_FOUND",
      "JOB_ALREADY_TERMINAL",
      "PERMISSION_DENIED_JOB_OWNER",
      "JOB_STEP_TIMEOUT",
      "JOB_OVERALL_DEADLINE_EXCEEDED",
      "JOB_MAX_ATTEMPTS_EXCEEDED",
      "JOB_SERIALIZATION_CONFLICT",
      "JOB_CANCELLED_BY_USER",
      "PERMISSION_DENIED_AUTHZ_AT_RUNTIME",
      "TOOL_EXECUTION_NOT_IMPLEMENTED",
    ];
    expect(JobErrorCodeSchema.options).toHaveLength(10);
    for (const code of expectedCodes) {
      expect(() => JobErrorCodeSchema.parse(code)).not.toThrow();
    }
  });
});

// ─── JobPrincipalSnapshotSchema ───────────────────────────────────────────────

describe("JobPrincipalSnapshotSchema", () => {
  const validSnapshot = {
    capturedTime: Date.now(),
    oboAudiencesNeeded: ["app.flow"],
    schema: "job-principal-v1",
    scopes: ["file.read"],
    tenant: 1001,
    userId: "u_abc123",
  };

  it("accepts a valid principal snapshot", () => {
    expect(() => JobPrincipalSnapshotSchema.parse(validSnapshot)).not.toThrow();
  });

  it("rejects wrong schema version", () => {
    expect(JobPrincipalSnapshotSchema.safeParse({ ...validSnapshot, schema: "job-principal-v2" }).success).toBe(false);
  });
});

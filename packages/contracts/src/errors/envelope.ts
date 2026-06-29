import { z } from "zod";

import { EpochMsSchema } from "../common/time";

/**
 * Standard error response body — 5 required fields, aligned with the
 * Kaihe platform's `ErrorResponse`
 * (regulation §10.1; `com.guhecloud.platform.base.model.ErrorResponse`).
 *
 * Notes:
 * - `code` is `SNAKE_CASE` UPPER or `null` (for unclassified internal errors).
 * - `details` is a free JSON object; PII is forbidden (§10.6).
 * - `traceId` is placed inside `details` as well as the `X-Trace-Id` header;
 *   it is NOT a top-level field (intentional alignment with Kaihe).
 */
export const ErrorResponseSchema = z.object({
  code: z.string().nullable(),
  details: z.unknown().nullable(),
  message: z.string(),
  status: z.number().int(),
  timestamp: EpochMsSchema,
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * Validated `details` object shape — `traceId` is always required
 * (regulation §10.2 + §10.6 — details.traceId must match X-Trace-Id header).
 * Additional fields are allowed (open record) but PII is forbidden.
 *
 * Added by P1-02 to give type safety when building error details at the
 * middleware layer.
 */
export const ErrorDetailsSchema = z
  .object({
    traceId: z.string().min(1),
  })
  .catchall(z.unknown());

export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;

/** Build a `details` object that always includes `traceId` and enforces a 4 KB size cap (regulation §10.6). */
export function buildErrorDetails(traceId: string, extra?: Record<string, unknown> | null): ErrorDetails {
  // traceId is authoritative; cannot be overridden by extra fields (regulation §10.6).
  const details: ErrorDetails = { ...extra, traceId };

  const MAX_DETAILS_BYTES = 4 * 1024;
  const json = JSON.stringify(details);
  if (Buffer.byteLength(json, "utf8") > MAX_DETAILS_BYTES) {
    return {
      reason: "details exceeded 4 KB",
      traceId,
      truncated: true,
    };
  }
  return details;
}

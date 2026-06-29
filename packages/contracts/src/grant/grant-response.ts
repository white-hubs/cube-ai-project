import { z } from "zod";

import { SfidSchema } from "../common/ids";

/**
 * POST /v1/grants/responses — client decision on a pending grant request.
 * Ref: docs/detailed-design/08-sdk/contracts.md §4.5
 */
export const GrantResponseRequestSchema = z
  .object({
    decision: z.enum(["APPROVE", "DENY"]),
    grantRequestId: SfidSchema,
    note: z.string().max(512).optional(),
    rememberTtlSeconds: z
      .number()
      .int()
      .positive()
      .max(30 * 24 * 3600)
      .optional(),
    scopeChoice: z.enum(["ONCE", "SESSION", "PERSISTENT"]).optional(),
  })
  .strict();
export type GrantResponseRequest = z.infer<typeof GrantResponseRequestSchema>;

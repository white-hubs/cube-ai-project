/**
 * Consent modal contracts + Grant Args DSL schema.
 *
 * Ref: docs/detailed-design/04-auth-and-authz/consent-modal-spec.md
 *      docs/detailed-design/04-auth-and-authz/authorization-gateway.md §5
 *      docs/adr/ADR-0013-grant-args-constraint-dsl.md
 */
import { z } from "zod";

/**
 * Consent Args DSL expression — jsonpath-v1 subset (ADR-0013).
 * Supported ops: eq / ne / in / nin / eqCtx / neCtx / and / or
 *
 * NOT supported in v1 (REJECT on write):
 *   - startsWith / endsWith / matchesRegex / lt / gt
 *   - JSONPath recursive (..) / filter (?()) / slice
 *
 * ref: authorization-gateway.md §5.2 §5.3
 */
export type ConsentArgsExpr =
  | { op: "eq"; path: string; value?: unknown }
  | { op: "ne"; path: string; value?: unknown }
  | { op: "in"; path: string; value: unknown[] }
  | { op: "nin"; path: string; value: unknown[] }
  | { op: "eqCtx"; path: string; ctx: CtxReference }
  | { op: "neCtx"; path: string; ctx: CtxReference }
  | { op: "and"; exprs: ConsentArgsExpr[] }
  | { op: "or"; exprs: ConsentArgsExpr[] };

/** Whitelisted context references for eqCtx / neCtx */
export const CTX_REFERENCES = ["principal.userId", "principal.tenant", "session.agentId", "session.sessionId"] as const;
export type CtxReference = (typeof CTX_REFERENCES)[number];

export const CtxReferenceSchema = z.enum(CTX_REFERENCES);

const baseExprSchema = z.union([
  z.object({ op: z.literal("eq"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("ne"), path: z.string(), value: z.unknown() }),
  z.object({ op: z.literal("in"), path: z.string(), value: z.array(z.unknown()) }),
  z.object({ op: z.literal("nin"), path: z.string(), value: z.array(z.unknown()) }),
  z.object({ ctx: CtxReferenceSchema, op: z.literal("eqCtx"), path: z.string() }),
  z.object({ ctx: CtxReferenceSchema, op: z.literal("neCtx"), path: z.string() }),
]);

export const ConsentArgsExprSchema: z.ZodType<ConsentArgsExpr> = z.lazy(() =>
  z.union([
    baseExprSchema,
    z.object({ exprs: z.array(ConsentArgsExprSchema), op: z.literal("and") }),
    z.object({ exprs: z.array(ConsentArgsExprSchema), op: z.literal("or") }),
  ]),
);

/**
 * Grant response body from the frontend consent modal.
 * ref: authorization-gateway.md §8.2
 * ref: consent-modal-spec.md §5.1
 */
export const GrantResponseBodySchema = z.object({
  decision: z.enum(["APPROVE", "APPROVE_PERSISTENT", "DENY"]),
  grantRequestId: z.string(),
  note: z.string().max(200).optional(),
  ttlDays: z.number().int().positive().optional(),
});

export type GrantResponseBody = z.infer<typeof GrantResponseBodySchema>;

/**
 * Consent scope choice — maps to Grant layer.
 * ref: consent-modal-spec.md §5.1
 */
export const ConsentScopeChoiceSchema = z.enum(["once", "session", "persistent"]);
export type ConsentScopeChoice = z.infer<typeof ConsentScopeChoiceSchema>;

/**
 * Grant request metadata stored in Redis while awaiting user consent.
 * Key: agentic:engine:authz:grantReq:{grantRequestId}
 * ref: grant-lifecycle.md §2.2
 */
export const GrantRequestSchema = z.object({
  /** Sanitised args for modal display — no PII */
  argsPreview: z.record(z.string(), z.unknown()).optional(),
  consentType: z.enum(["ON_FIRST_USE", "EACH_CALL"]),
  createTime: z.number(),
  grantRequestId: z.string(),
  respondedTime: z.number().optional(),
  scopeHint: z.enum(["ONCE", "PERSISTENT"]).optional(),
  sessionId: z.string().optional(),
  status: z.enum(["PENDING", "APPROVED", "APPROVED_PERSISTENT", "DENIED", "EXPIRED"]),
  tenant: z.number().int().positive(),
  toolCallId: z.string().optional(),
  toolName: z.string(),
  ttlSeconds: z.number().int().positive().default(60),
  turnId: z.string().optional(),
  userId: z.string(),
});

export type GrantRequest = z.infer<typeof GrantRequestSchema>;

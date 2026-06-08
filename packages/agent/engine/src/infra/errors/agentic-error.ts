import type { ErrorResponse } from '@cube-ai/contracts';
import { DEFAULT_HTTP_STATUS, categoryOf } from '@cube-ai/contracts';
import type { ErrorCategory } from './error-categories';

/**
 * Abstract base class for all engine-side exceptions.
 *
 * Each concrete subclass pins `code`, `category`, and `httpStatus`.
 * `toResponse()` emits the canonical 5-field envelope (§10.1) with
 * `details.traceId` as mandated by the naming-and-db-conventions spec.
 *
 * ref: docs/detailed-design/00-foundations/naming-and-db-conventions.md §10.1-§10.5
 *      docs/technical-design/phase-1/P1-01-foundations.md §3.3
 */
export abstract class AgenticError extends Error {
  abstract readonly code: string;
  abstract readonly category: ErrorCategory;
  abstract readonly httpStatus: number;

  constructor(
    message: string,
    public readonly details: Record<string, unknown> | null = null,
  ) {
    super(message);
    this.name = this.constructor.name;
  }

  /**
   * Produce the canonical 5-field error envelope.
   * `traceId` goes into `details.traceId` (NOT a top-level field).
   * ref: naming-and-db-conventions.md §10.1, §10.2
   */
  toResponse(traceId: string): ErrorResponse {
    return {
      status:    this.httpStatus,
      code:      this.code,
      message:   this.message,
      details:   { ...(this.details ?? {}), traceId },
      timestamp: Date.now(),
    };
  }
}

// ─── 12 concrete subclasses ────────────────────────────────────────────────

/**
 * HTTP 412 — Input failed schema / argument validation.
 * category: INVALID_ARGUMENT | OUT_OF_RANGE
 * ref: naming-and-db-conventions.md §10.3 row "412"
 */
export class AgenticValidationError extends AgenticError {
  readonly category: ErrorCategory = 'INVALID_ARGUMENT';
  readonly httpStatus = 412;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 401 — Authentication failure (missing / expired / invalid token).
 * category: UNAUTHENTICATED
 */
export class AgenticAuthError extends AgenticError {
  readonly category: ErrorCategory = 'UNAUTHENTICATED';
  readonly httpStatus = 401;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 403 — Authorization denied (scope insufficient / grant missing).
 * category: PERMISSION_DENIED
 */
export class AgenticAuthZError extends AgenticError {
  readonly category: ErrorCategory = 'PERMISSION_DENIED';
  readonly httpStatus = 403;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 404 — Resource does not exist.
 * category: RESOURCE_NOT_FOUND
 */
export class AgenticNotFoundError extends AgenticError {
  readonly category: ErrorCategory = 'RESOURCE_NOT_FOUND';
  readonly httpStatus = 404;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 409 — Concurrent or version conflict.
 * category: RESOURCE_CONFLICT
 */
export class AgenticConflictError extends AgenticError {
  readonly category: ErrorCategory = 'RESOURCE_CONFLICT';
  readonly httpStatus = 409;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 429 — Rate limit exceeded.
 * category: RATELIMIT
 */
export class AgenticRateLimitError extends AgenticError {
  readonly category: ErrorCategory = 'RATELIMIT';
  readonly httpStatus = 429;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 412 — General business rule violation (not a schema error).
 * category: INVALID_ARGUMENT (business semantic)
 */
export class AgenticBusinessError extends AgenticError {
  readonly category: ErrorCategory = 'INVALID_ARGUMENT';
  readonly httpStatus = 412;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 500 — Unclassified internal error.
 * category: INTERNAL
 */
export class AgenticInternalError extends AgenticError {
  readonly category: ErrorCategory = 'INTERNAL';
  readonly httpStatus = 500;
  constructor(
    readonly code: string = 'INTERNAL_UNKNOWN',
    message: string = 'An unexpected internal error occurred',
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 502 — Upstream service error (LLM / OAuth2 / Nacos / MySQL).
 * category: UPSTREAM
 */
export class AgenticUpstreamError extends AgenticError {
  readonly category: ErrorCategory = 'UPSTREAM';
  readonly httpStatus = 502;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 504 — Upstream or internal operation timed out.
 * category: UPSTREAM (timeout is an upstream / infra concern)
 */
export class AgenticTimeoutError extends AgenticError {
  readonly category: ErrorCategory = 'UPSTREAM';
  readonly httpStatus = 504;
  constructor(
    readonly code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 403 — Cross-tenant data access attempt detected at runtime.
 * category: PERMISSION_DENIED
 *
 * Thrown by TenantContextService.require() indirectly, or explicitly by
 * repository / adapter layers when they detect a tenant mismatch.
 *
 * ref: docs/detailed-design/12-security/tenant-isolation-matrix.md
 */
export class TenantIsolationViolation extends AgenticError {
  readonly code = 'PERMISSION_DENIED_TENANT_ISOLATION_VIOLATION';
  readonly category: ErrorCategory = 'PERMISSION_DENIED';
  readonly httpStatus = 403;
  constructor(message = 'Tenant isolation violation detected', details?: Record<string, unknown>) {
    super(message, details ?? null);
  }
}

/**
 * HTTP 501 — Feature not yet implemented (Phase 1 placeholder).
 * category: UNIMPLEMENTED
 *
 * Use as a `throw` placeholder in skeleton methods:
 *   throw new NotImplementedError('P1-01.method: ref design doc §N.M')
 *
 * ref: docs/technical-design/prompts/phase-1/shared-context.md §4.2
 */
export class NotImplementedError extends AgenticError {
  readonly code = 'UNIMPLEMENTED_PHASE1';
  readonly category: ErrorCategory = 'UNIMPLEMENTED';
  readonly httpStatus = 501;
  constructor(context: string = 'method') {
    super(`Not implemented: ${context}`);
  }
}

// ─── Dynamic factory class (P1-02) ─────────────────────────────────────────
//
// `AgenticEngineError` is an instantiable error class that carries an
// arbitrary engine error `code` (string) plus the resolved HTTP status,
// produced by the `fromCode(...)` static factory. The factory looks up the
// error's category via `categoryOf(code)` (closed set, see ADR-0015) and
// maps to the canonical HTTP status via `DEFAULT_HTTP_STATUS[category]`.
//
// The 12 concrete `Agentic*Error` subclasses above are still the preferred
// surface for typed throw sites in business code (compile-time exhaustive
// pattern matching on `error.constructor`). `AgenticEngineError.fromCode()`
// is the dynamic surface used by middleware (envelope mapper, Zod
// validator, exception mapper) where the code is decided at runtime.
//
// `extends AgenticError` (the abstract base) makes both surfaces
// inter-operate: BC code can `try/catch (e: AgenticError)` and treat both
// kinds uniformly via `toResponse(traceId)`.
//
// ref: docs/technical-design/phase-1/P1-02-api.md §3 — exception mapper
//      docs/adr/ADR-0015 — closed set of 17 error categories
export class AgenticEngineError extends AgenticError {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly httpStatus: number;

  constructor(
    httpStatus: number,
    code: string | null,
    message: string,
    details: Record<string, unknown> | null = null,
  ) {
    super(message, details);
    this.code = code ?? 'INTERNAL_UNKNOWN';
    this.category = (categoryOf(this.code) ?? 'INTERNAL') as ErrorCategory;
    this.httpStatus = httpStatus;
  }

  /**
   * Alias of `httpStatus`. Kept because P1-02 middleware historically
   * referenced `err.status`; both names point to the same numeric HTTP
   * status code defined by §10.3.
   */
  get status(): number {
    return this.httpStatus;
  }

  static fromCode(
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ): AgenticEngineError {
    const cat = categoryOf(code);
    const status = cat ? DEFAULT_HTTP_STATUS[cat] : 500;
    return new AgenticEngineError(status, code, message, details ?? null);
  }
}

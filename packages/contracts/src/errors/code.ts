/**
 * Closed set of `CATEGORY` prefixes for error codes
 * (ADR-0015 — 17 server-visible categories + SDK-only CLIENT_*).
 *
 * Sub-codes follow `{CATEGORY}_{SUBJECT}_{REASON}` all-UPPER_SNAKE_CASE.
 * Full catalogue lives in `docs/detailed-design/01-api/README.md` §16.
 */
export const ERROR_CATEGORIES = [
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'RESOURCE_NOT_FOUND',
  'RESOURCE_CONFLICT',
  'FAILED_PRECONDITION',
  'INVALID_ARGUMENT',
  'OUT_OF_RANGE',
  'RATELIMIT',
  'UNIMPLEMENTED',
  'UPSTREAM',
  'INTERNAL',
  'UNSUPPORTED',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'CANCELLED',
  'CLIENT_NETWORK',
  'CLIENT_TIMEOUT',
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

/**
 * HTTP status code defaults per category.
 * SDK-only categories map to 500 if accidentally emitted server-side.
 */
export const DEFAULT_HTTP_STATUS: Record<ErrorCategory, number> = {
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  RESOURCE_CONFLICT: 409,
  FAILED_PRECONDITION: 412,
  INVALID_ARGUMENT: 412,
  OUT_OF_RANGE: 412,
  RATELIMIT: 429,
  UNIMPLEMENTED: 501,
  UPSTREAM: 502,
  INTERNAL: 500,
  UNSUPPORTED: 503,
  UNAVAILABLE: 503,
  DEADLINE_EXCEEDED: 504,
  CANCELLED: 499,
  CLIENT_NETWORK: 500,
  CLIENT_TIMEOUT: 500,
};

/** Longest-prefix-first matching order for `categoryOf`. */
const CATEGORY_MATCH_ORDER = [...ERROR_CATEGORIES].sort(
  (a, b) => b.length - a.length,
);

/**
 * Representative skeleton codes; domains extend via `{CATEGORY}_*` prefixes.
 */
export const KNOWN_ERROR_CODES = [
  'UNAUTHENTICATED_TOKEN_INVALID',
  'UNAUTHENTICATED_TOKEN_EXPIRED',
  'PERMISSION_DENIED_GRANT_MISSING',
  'PERMISSION_DENIED_SCOPE_INSUFFICIENT',
  'INVALID_ARGUMENT_SESSION_ID',
  'INVALID_ARGUMENT_SCHEMA_VIOLATION',
  'OUT_OF_RANGE_MESSAGE_LENGTH',
  'RESOURCE_NOT_FOUND_SESSION',
  'RESOURCE_NOT_FOUND_DESCRIPTOR',
  'RESOURCE_CONFLICT_TURN_RUNNING',
  'RATELIMIT_SESSION_EXCEEDED',
  'RATELIMIT_TENANT_EXCEEDED',
  'UNIMPLEMENTED_TOKEN_REVOKE',
  'UPSTREAM_LLM_UNAVAILABLE',
  'UPSTREAM_OAUTH_INTROSPECT_FAIL',
  'INTERNAL_UNKNOWN',
  'INTERNAL_DB_TX_FAILED',
  'UNAVAILABLE_SECRET_NOT_FOUND',
] as const;
export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number];

/**
 * Runtime guard: assert a string is one of the known skeleton codes.
 */
export function isKnownErrorCode(value: string): value is KnownErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(value);
}

export function categoryOf(code: string): ErrorCategory | null {
  for (const cat of CATEGORY_MATCH_ORDER) {
    if (code === cat || code.startsWith(`${cat}_`)) {
      return cat;
    }
  }
  return null;
}

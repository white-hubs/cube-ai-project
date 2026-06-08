/**
 * Canonical SDK/engine collaboration headers (aligned with
 * `docs/detailed-design/08-sdk/versioning.md`). Header names are the
 * HTTP-canonical casing; engine accepts them case-insensitively as per RFC.
 * Ref: contracts.md §4.8 / versioning.md §3
 */
export const HEADER_AGENTIC_VERSION = 'X-Agentic-Version';
export const HEADER_AGENTIC_CAPABILITY = 'X-Agentic-Capability';
export const HEADER_TRACE_ID = 'X-Trace-Id';
export const HEADER_IDEMPOTENCY_KEY = 'Idempotency-Key';
export const HEADER_REQUEST_ID = 'X-Request-Id';
export const HEADER_IDEMPOTENT_REPLAY = 'X-Idempotent-Replay';
export const HEADER_SDK_VERSION = 'X-Agentic-SDK-Version';
export const HEADER_ENGINE_VERSION = 'X-Agentic-Engine-Version';
export const HEADER_CONTRACTS_VERSION = 'X-Agentic-Contracts-Version';
export const HEADER_SDK_DEPRECATED = 'X-Agentic-SDK-Deprecated';
export const HEADER_SDK_MIN_SUPPORTED = 'X-Agentic-SDK-Min-Supported';
export const HEADER_SDK_SUNSET = 'X-Agentic-SDK-Sunset';
export const HEADER_CLIENT_NAME = 'X-Client-Name';

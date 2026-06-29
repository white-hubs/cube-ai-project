/**
 * GhcloudPlatformError — uniform error type emitted by all three adapters.
 * Engine handlers map this to AgenticEngineError via the code field.
 */

export type GhcloudPlatformErrorCode =
  | "UPSTREAM_TOOL_HTTP_FAILED"
  | "UPSTREAM_NETWORK_TIMEOUT"
  | "UPSTREAM_AUTH_FAILED"
  | "INVALID_ARGUMENT_SCHEMA_VIOLATION"
  | "RESOURCE_NOT_FOUND_REMOTE"
  | "FAILED_PRECONDITION_UPSTREAM";

export class GhcloudPlatformError extends Error {
  readonly code: GhcloudPlatformErrorCode;
  readonly details: Record<string, unknown> | undefined;

  private constructor(code: GhcloudPlatformErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "GhcloudPlatformError";
    this.code = code;
    this.details = details;
  }

  static fromCode(code: GhcloudPlatformErrorCode, message: string, details?: Record<string, unknown>): GhcloudPlatformError {
    return new GhcloudPlatformError(code, message, details);
  }
}

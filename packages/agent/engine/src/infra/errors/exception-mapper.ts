import { HttpException } from '@dangao/bun-server';
import { ZodError } from 'zod';

import { AgenticEngineError, AgenticError } from './agentic-error';
import { extractNetworkError, formatNetworkErrorMessage } from './network-error';

function httpStatusToDefaultCode(status: number): string {
  switch (status) {
    case 400:
      return 'INVALID_ARGUMENT';
    case 401:
      return 'UNAUTHENTICATED_MISSING_TOKEN';
    case 403:
      return 'PERMISSION_DENIED';
    case 404:
      return 'RESOURCE_NOT_FOUND';
    case 409:
      return 'RESOURCE_CONFLICT';
    case 412:
      return 'INVALID_ARGUMENT_SCHEMA_VIOLATION';
    case 429:
      return 'RATELIMIT_EXCEEDED';
    case 502:
      return 'UPSTREAM_UNAVAILABLE';
    case 503:
      return 'UPSTREAM_UNAVAILABLE';
    case 504:
      return 'UPSTREAM_TIMEOUT';
    default:
      return status >= 500 ? 'INTERNAL_UNKNOWN' : 'INVALID_ARGUMENT';
  }
}

function isBunServerHttpException(err: unknown): err is HttpException {
  return (
    err instanceof HttpException ||
    (typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof (err as { status: unknown }).status === 'number' &&
      'message' in err &&
      typeof (err as { message: unknown }).message === 'string')
  );
}

/**
 * Exception mapper — P1-02 API envelope.
 *
 * Converts any thrown value into an `AgenticEngineError` so the
 * `errorResponseMiddleware` can render a uniform 5-field envelope.
 *
 * Rules:
 * - `AgenticEngineError` → unchanged
 * - `@dangao/bun-server` `HttpException` → mapped HTTP status + code
 * - Other `AgenticError` subclasses → normalized to `AgenticEngineError`
 * - `ZodError` → `INVALID_ARGUMENT_SCHEMA_VIOLATION`
 * - Unknown → `INTERNAL_UNKNOWN`
 */
export function mapToAgenticError(err: unknown): AgenticEngineError {
  if (err instanceof AgenticEngineError) {
    return err;
  }

  if (err instanceof ZodError) {
    return AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'Invalid request body',
      {
        fieldErrors: err.flatten() as Record<string, unknown>,
      },
    );
  }

  if (isBunServerHttpException(err)) {
    const httpErr = err as HttpException & {
      code?: string;
      details?: Record<string, unknown>;
    };
    const code = httpErr.code ?? httpStatusToDefaultCode(httpErr.status);
    return new AgenticEngineError(
      httpErr.status,
      code,
      httpErr.message,
      httpErr.details ?? null,
    );
  }

  if (err instanceof AgenticError) {
    const e = err as AgenticError & {
      readonly code: string;
      readonly httpStatus: number;
    };
    return new AgenticEngineError(
      e.httpStatus,
      e.code,
      e.message,
      e.details,
    );
  }

  if (err instanceof Error && /Provider not found for token:/.test(err.message)) {
    return new AgenticEngineError(
      503,
      'INTERNAL_DI_MISCONFIGURATION',
      err.message,
    );
  }

  const networkError = extractNetworkError(err);
  if (networkError) {
    return new AgenticEngineError(
      503,
      'UPSTREAM_UNAVAILABLE',
      formatNetworkErrorMessage(networkError),
      { ...networkError },
    );
  }

  return AgenticEngineError.fromCode(
    'INTERNAL_UNKNOWN',
    'An unexpected error occurred',
  );
}

export function isAgenticError(err: unknown): err is AgenticEngineError {
  return err instanceof AgenticEngineError;
}

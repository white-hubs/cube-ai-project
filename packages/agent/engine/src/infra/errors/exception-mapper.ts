import { ZodError } from 'zod';

import { AgenticEngineError, AgenticError } from './agentic-error';

/**
 * Exception mapper — P1-02 API envelope.
 *
 * Converts any thrown value into an `AgenticEngineError` so the
 * `errorResponseMiddleware` can render a uniform 5-field envelope.
 *
 * Rules:
 * - `AgenticEngineError` → unchanged
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

  return AgenticEngineError.fromCode(
    'INTERNAL_UNKNOWN',
    'An unexpected error occurred',
  );
}

export function isAgenticError(err: unknown): err is AgenticEngineError {
  return err instanceof AgenticEngineError;
}

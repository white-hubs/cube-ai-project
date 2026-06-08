import { z } from 'zod';
import { AgenticEngineError } from './agentic-error';

/**
 * Zod body validator — P1-02 API envelope.
 *
 * Wraps `schema.safeParse(body)` and converts parse failures into a typed
 * `AgenticEngineError` so the `errorResponseMiddleware` renders a standard
 * 5-field envelope automatically.
 *
 * Error code: `INVALID_ARGUMENT_SCHEMA_VIOLATION` (HTTP 412).
 * Note: HTTP 422 is explicitly prohibited in the M1 spec
 * (01-api/README.md §5.3 + naming-and-db-conventions.md §10.3).
 * See design doc §13 prompt歧义 A-1 for details.
 *
 * Regulation:
 * - naming-and-db-conventions.md §10.5 INVALID_ARGUMENT → HTTP 412
 * - 01-api/README.md §16.3 INVALID_ARGUMENT_SCHEMA_VIOLATION sub-code
 * - 01-api/README.md §5.6 details.fieldErrors shape（`flatten()` 结构）
 */
export function validateBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown,
): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'Invalid request body',
      {
        fieldErrors: result.error.flatten() as Record<string, unknown>,
      },
    );
  }
  return result.data;
}

/**
 * Validate a query-params object. Identical semantics to `validateBody`.
 */
export function validateQuery<T extends z.ZodTypeAny>(
  schema: T,
  query: unknown,
): z.infer<T> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      'Invalid query parameters',
      {
        fieldErrors: result.error.flatten() as Record<string, unknown>,
      },
    );
  }
  return result.data;
}

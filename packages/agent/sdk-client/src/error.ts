import { ErrorResponseSchema, type ErrorResponse } from '@cube-ai/contracts';

/**
 * SDK-side mirror of the engine's 5-field error envelope
 * (regulation §10.7 sample TypeScript).
 */
export class AgenticError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | null,
    message: string,
    public readonly details: unknown,
    public readonly timestamp: number,
  ) {
    super(message);
    this.name = 'AgenticError';
  }

  static async fromResponse(response: Response): Promise<AgenticError> {
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* body might be plain text */
    }
    const parsed = ErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      const b: ErrorResponse = parsed.data;
      return new AgenticError(b.status, b.code, b.message, b.details, b.timestamp);
    }
    return new AgenticError(
      response.status,
      null,
      response.statusText || text || 'Unknown error',
      null,
      Date.now(),
    );
  }
}

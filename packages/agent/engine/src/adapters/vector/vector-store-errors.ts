/**
 * Qdrant / 向量存储错码（对齐 01-api §16 / P3-13 错误映射表；不依赖 engine 包）
 */
export type VectorStoreErrorCode =
  | 'NOT_FOUND_COLLECTION'
  | 'UNAVAILABLE_VECTOR_STORE'
  | 'INVALID_ARGUMENT_VECTOR'
  | 'INVALID_ARGUMENT_VECTOR_TENANT';

export class VectorStoreOpError extends Error {
  constructor(
    readonly code: VectorStoreErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'VectorStoreOpError';
  }
}

/** 将 @qdrant/js-client-rest 异常映射为闭集错码 */
export function mapQdrantClientError(err: unknown): VectorStoreOpError {
  const status = extractHttpStatus(err);
  if (status === 404) {
    return new VectorStoreOpError(
      'NOT_FOUND_COLLECTION',
      'Qdrant collection or resource not found',
      { cause: err },
    );
  }
  if (status !== undefined && status >= 500) {
    return new VectorStoreOpError(
      'UNAVAILABLE_VECTOR_STORE',
      `Qdrant server error (${status})`,
      { cause: err },
    );
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return new VectorStoreOpError(
      'INVALID_ARGUMENT_VECTOR',
      `Qdrant client error (${status})`,
      { cause: err },
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new VectorStoreOpError(
    'UNAVAILABLE_VECTOR_STORE',
    `Qdrant request failed: ${msg}`,
    { cause: err },
  );
}

function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object') {
    const anyErr = err as Record<string, unknown>;
    const resp = anyErr['response'] as Record<string, unknown> | undefined;
    const s = resp?.['status'] ?? anyErr['status'] ?? anyErr['statusCode'];
    if (typeof s === 'number') return s;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const m = /\b(\d{3})\b/.exec(msg);
  if (m) return Number(m[1]);
  return undefined;
}

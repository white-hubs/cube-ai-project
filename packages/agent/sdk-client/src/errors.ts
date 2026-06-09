import { ErrorResponseSchema, type ErrorResponse } from '@cube-ai/contracts';

/**
 * Client-side error wrapping the 5-field engine error envelope.
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §9
 */
export class AgenticClientError extends Error {
  constructor(
    public readonly code:       string | null,
    public readonly httpStatus: number | null,
    message: string,
    public readonly details:    unknown,
    public readonly traceId:    string | null,
    public readonly timestamp:  number,
    cause?: Error,
  ) {
    super(message);
    this.name = 'AgenticClientError';
    if (cause) this.cause = cause;
  }

  /**
   * 把 HTTP Response 解析为强类型错误。
   * 优先级：
   *   1. 409 + RESOURCE_CONFLICT_TURN_RUNNING / RESOURCE_CONFLICT_SESSION_BUSY / 文本含
   *      "already has a running turn" → `SessionBusyError`（ADR-0008 §D5.2）
   *   2. 其它 → `AgenticClientError`
   */
  static async fromResponse(response: Response): Promise<AgenticClientError> {
    const traceId =
      response.headers.get('x-trace-id') ?? response.headers.get('X-Trace-Id');
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* body 可能是纯文本 */
    }
    const parsed = ErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      const b: ErrorResponse = parsed.data;
      const detailsTraceId =
        b.details && typeof b.details === 'object' && 'traceId' in b.details
          ? String((b.details as Record<string, unknown>).traceId)
          : null;
      const resolvedTraceId = traceId ?? detailsTraceId;
      if (isSessionBusySignal(response.status, b.code, b.message)) {
        return new SessionBusyError(
          b.code,
          b.status,
          b.message,
          b.details,
          resolvedTraceId,
          b.timestamp,
        );
      }
      return new AgenticClientError(
        b.code,
        b.status,
        b.message,
        b.details,
        resolvedTraceId,
        b.timestamp,
      );
    }
    if (isSessionBusySignal(response.status, null, response.statusText)) {
      return new SessionBusyError(
        null,
        response.status,
        response.statusText || 'session busy',
        null,
        traceId,
        Date.now(),
      );
    }
    return new AgenticClientError(
      null,
      response.status,
      response.statusText || 'Unknown error',
      null,
      traceId,
      Date.now(),
    );
  }
}

function isSessionBusySignal(
  httpStatus: number,
  code: string | null,
  message: string | null,
): boolean {
  if (httpStatus !== 409) return false;
  if (
    code === 'RESOURCE_CONFLICT_TURN_RUNNING' ||
    code === 'RESOURCE_CONFLICT_SESSION_BUSY'
  ) {
    return true;
  }
  if (message && /already has a running turn/i.test(message)) return true;
  return false;
}

/**
 * Engine reports "session already has a running turn" (HTTP 409 + 特定 code)。
 * 本地预检（`AssistantStore.send` 在 `sending=true` 时直接抛）也走此类型。
 * ADR-0008 §D5.2 / Q11 G1
 */
export class SessionBusyError extends AgenticClientError {
  constructor(
    code: string | null,
    httpStatus: number | null,
    message: string,
    details: unknown,
    traceId: string | null,
    timestamp: number,
    cause?: Error,
  ) {
    super(code, httpStatus, message, details, traceId, timestamp, cause);
    this.name = 'SessionBusyError';
  }

  /** Pure-local 预检快速构造（不发请求）。 */
  static local(message = 'another turn is in flight'): SessionBusyError {
    return new SessionBusyError(
      'RESOURCE_CONFLICT_SESSION_BUSY',
      409,
      message,
      null,
      null,
      Date.now(),
    );
  }
}

/**
 * `POST /sessions/:id/messages` 失败（含 4xx/5xx/网络错误）。
 * 调用方区分"消息没发出去（startTurn 失败）"与"消息发出去但 stream 断了（StreamDisconnectedError）"。
 */
export class StartTurnFailedError extends AgenticClientError {
  constructor(
    code: string | null,
    httpStatus: number | null,
    message: string,
    details: unknown,
    traceId: string | null,
    timestamp: number,
    cause?: Error,
  ) {
    super(code, httpStatus, message, details, traceId, timestamp, cause);
    this.name = 'StartTurnFailedError';
  }
}

/**
 * `GET /sessions/:id/events` 流中断（网络错误 / reader 在 done 前 reject）。
 * 首版 SDK 不重连（ADR-0008 §D1 TODO）；调用方决定是否提示用户刷新页面。
 * 与 `StartTurnFailedError` 同源信号：前者代表"消息没发出去"，后者代表"消息发出去但流断了"。
 */
export class StreamDisconnectedError extends AgenticClientError {
  constructor(
    message = 'SSE stream disconnected',
    cause?: Error,
  ) {
    super(
      'CLIENT_NETWORK_STREAM_DISCONNECTED',
      null,
      message,
      null,
      null,
      Date.now(),
      cause,
    );
    this.name = 'StreamDisconnectedError';
  }
}

/**
 * `AssistantStore.dispose()` 之后再调用任何 Store 方法。
 * 由 sdk-assistant 抛出但定义在 sdk-core 以便上层类型解析。
 */
export class StoreDisposedError extends Error {
  constructor(method: string) {
    super(`AssistantStore.${method}() called after dispose()`);
    this.name = 'StoreDisposedError';
  }
}

import { SseEventSchema, type SseEvent } from '@cube-ai/contracts';
import { AgenticClientError } from './errors';

export type SseEventHandler = (event: SseEvent) => void;
export type SseErrorHandler = (error: Error) => void;

/**
 * SSE client using fetch + ReadableStream (not native EventSource).
 * Supports Authorization header injection and Last-Event-ID reconnect.
 * Ref: docs/detailed-design/08-sdk/sdk-core.md §6
 */
export class SseClient {
  private lastEventId: string | undefined;
  private retries = 0;
  private aborted = false;

  constructor(
    private readonly maxReconnectAttempts: number = 5,
    private readonly baseReconnectDelayMs: number = 500,
    private readonly fetchImpl: typeof fetch = fetch.bind(globalThis),
  ) {}

  get lastEventID(): string | undefined {
    return this.lastEventId;
  }

  /**
   * Subscribe to a SSE endpoint.
   * Returns an unsubscribe function.
   * Reconnect algorithm:
   *   - Natural close (server ends stream): reconnect up to maxReconnectAttempts times.
   *   - Network error / throw: same counter.
   *   - HTTP non-2xx: no reconnect, call onError and exit.
   *   - unsubscribe() called: exit immediately.
   * Ref: sdk-core.md §6.4 reconnect algorithm
   */
  subscribe(
    url: string,
    opts: {
      method:    'GET' | 'POST';
      headers:   Record<string, string>;
      body?:     string;
      onEvent:   SseEventHandler;
      onError?:  SseErrorHandler;
      onClose?:  () => void;
      /** Optional external abort（与内部 controller 联动） */
      signal?:   AbortSignal;
    },
  ): () => void {
    this.aborted = false;
    this.retries = 0;
    const abortCtl = new AbortController();

    const onAbortExt = () => abortCtl.abort();
    opts.signal?.addEventListener('abort', onAbortExt);

    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const connect = async () => {
      while (!this.aborted) {
        const headers: Record<string, string> = { ...opts.headers };
        if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;

        let naturalClose = false;
        try {
          const init: RequestInit = {
            method:  opts.method,
            headers: { ...headers, Accept: 'text/event-stream' },
            signal:  abortCtl.signal,
          };
          if (opts.body !== undefined) init.body = opts.body;
          const resp = await this.fetchImpl(url, init);

          if (!resp.ok) {
            const err = await AgenticClientError.fromResponse(resp);
            opts.onError?.(err);
            break;
          }

          await this.consumeStream(resp, opts.onEvent, opts.onError);
          naturalClose = true;
        } catch (e: unknown) {
          if (this.aborted || abortCtl.signal.aborted) break;
        }

        if (this.aborted) break;

        this.retries++;
        if (this.retries > this.maxReconnectAttempts) {
          if (!naturalClose) opts.onError?.(new Error('SSE reconnect exhausted'));
          break;
        }

        const backoff = Math.min(
          this.baseReconnectDelayMs * Math.pow(2, this.retries - 1),
          30_000,
        ) + Math.random() * 300;
        await delay(backoff);
      }
      opts.onClose?.();
    };

    connect().catch(e => opts.onError?.(e as Error));

    return () => {
      opts.signal?.removeEventListener('abort', onAbortExt);
      this.aborted = true;
      abortCtl.abort();
    };
  }

  private async consumeStream(
    resp: Response,
    onEvent: SseEventHandler,
    _onError?: SseErrorHandler,
  ): Promise<void> {
    if (!resp.body) return;
    const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let currentId: string | undefined;
    let currentEvent: string | undefined;
    let dataLines: string[] = [];

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const raw = buffer.slice(0, idx).replace(/\r$/, '');
        buffer = buffer.slice(idx + 1);
        if (raw.length === 0) {
          // dispatch event
          if (dataLines.length > 0) {
            const rawData = dataLines.join('\n');
            try {
              const parsed = JSON.parse(rawData);
              const result = SseEventSchema.safeParse(parsed);
              if (result.success) {
                if (currentId) this.lastEventId = currentId;
                onEvent(result.data);
              }
              // Unknown schema → soft fail per contracts.md §5.3
            } catch {
              // malformed JSON → skip
            }
          }
          currentId = undefined;
          currentEvent = undefined;
          dataLines = [];
          continue;
        }
        if (raw.startsWith(':')) continue; // keep-alive comment
        const colon = raw.indexOf(':');
        if (colon === -1) continue;
        const field = raw.slice(0, colon).trim();
        const val   = raw.slice(colon + 1).replace(/^ /, '');
        switch (field) {
          case 'id':    currentId = val;    break;
          case 'event': currentEvent = val; break;
          case 'data':  dataLines.push(val); break;
          default: break;
        }
      }
    }
    void currentEvent; // suppress unused-var lint
  }
}

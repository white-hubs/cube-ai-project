/**
 * `@Sse()` decorator stub.
 *
 * Marks a controller method as an SSE source. Phase 0a is a metadata-only
 * marker so the engine can build its own SSE pipeline; Phase 3 wires this
 * into `@dangao/bun-server`'s route machinery once an officially-supported
 * `text/event-stream` handler extension lands.
 */
export const SSE_ROUTE_METADATA_KEY = Symbol.for('@cube-ai/bun-server-ext-sse:route');

export interface SseRouteOptions {
  /** Default SSE keep-alive comment interval in ms (default 15_000 per bun-server). */
  keepAliveIntervalMs?: number;
  /** Whether the handler consults the replay buffer on `Last-Event-ID`. */
  supportsLastEventId?: boolean;
}

export function Sse(options: SseRouteOptions = {}): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata?.(SSE_ROUTE_METADATA_KEY, options, target, propertyKey);
  };
}

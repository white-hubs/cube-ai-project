import type { EngineEvent, ExecutionContext, ObservabilityEmitter } from '@tachu/core';

/** Host-side engine events (emitted before / outside tachu pipeline). */
export type HostEngineEventType =
  | 'knowledge_prefetch_end'
  | 'knowledge_prefetch_skipped'
  | 'knowledge_prefetch_failed';

export type HostEngineEvent = Omit<EngineEvent, 'type'> & {
  type: HostEngineEventType;
};

export function emitHostEngineEvent(
  observability: ObservabilityEmitter | undefined,
  context: ExecutionContext,
  event: Omit<HostEngineEvent, 'correlation' | 'subject'>,
): void {
  if (!observability) {
    return;
  }
  observability.emit({
    ...event,
    correlation: context.correlation,
    ...(context.subject !== undefined ? { subject: context.subject } : {}),
  } as EngineEvent);
}

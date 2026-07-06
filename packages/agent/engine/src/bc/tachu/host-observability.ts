import type { EngineEvent, ExecutionContext, ObservabilityEmitter } from "@tachu/core";

/** Host-side engine events (emitted before / outside tachu pipeline). */
export type HostEngineEventType =
  | "knowledge_prefetch_end"
  | "knowledge_prefetch_skipped"
  | "knowledge_prefetch_failed"
  | "grounding_prefetch_end"
  | "grounding_prefetch_skipped"
  | "grounding_prefetch_failed"
  | "manual_rule_injected"
  | "skill_pin_unresolved";

export type HostEngineEvent = Omit<EngineEvent, "type"> & {
  type: HostEngineEventType;
};

export function emitHostEngineEvent(
  observability: ObservabilityEmitter | undefined,
  context: ExecutionContext,
  event: Omit<HostEngineEvent, "correlation" | "subject">,
): void {
  if (!observability) {
    return;
  }
  observability.emit({
    ...event,
    correlation: context.correlation,
    ...(context.subject !== undefined ? { subject: context.subject } : {}),
  } as unknown as EngineEvent);
}

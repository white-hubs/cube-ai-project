import { type Ref, onScopeDispose, ref } from "vue";

import { type AgenticClient } from "@cube-ai/agent-sdk-client";
import { type GrantRequestEvent, type SseEvent } from "@cube-ai/contracts";

/**
 * Reactive grant request handler.
 * Ref: docs/detailed-design/08-sdk/sdk-vue.md §3.5
 */
export function useGrants(client: AgenticClient): {
  pendingGrant: Ref<GrantRequestEvent | null>;
  approve: (opts?: { scopeChoice?: "ONCE" | "SESSION" | "PERSISTENT"; rememberTtlSeconds?: number; note?: string }) => Promise<void>;
  deny: (opts?: { note?: string }) => Promise<void>;
  handleEvent: (event: SseEvent) => void;
} {
  const pendingGrant = ref<GrantRequestEvent | null>(null);

  const handleEvent = (event: SseEvent) => {
    if (event.schema === "grant-request-v1") {
      pendingGrant.value = event;
    }
  };

  const approve = async (opts?: { scopeChoice?: "ONCE" | "SESSION" | "PERSISTENT"; rememberTtlSeconds?: number; note?: string }) => {
    const grant = pendingGrant.value;
    if (!grant) {
      return;
    }
    await client.grants.respond({
      decision: "APPROVE",
      grantRequestId: grant.grantRequestId,
      note: opts?.note,
      rememberTtlSeconds: opts?.rememberTtlSeconds,
      scopeChoice: opts?.scopeChoice,
    });
    pendingGrant.value = null;
  };

  const deny = async (opts?: { note?: string }) => {
    const grant = pendingGrant.value;
    if (!grant) {
      return;
    }
    await client.grants.respond({
      decision: "DENY",
      grantRequestId: grant.grantRequestId,
      note: opts?.note,
    });
    pendingGrant.value = null;
  };

  onScopeDispose(() => {
    pendingGrant.value = null;
  });

  return { approve, deny, handleEvent, pendingGrant: pendingGrant as Ref<GrantRequestEvent | null> };
}

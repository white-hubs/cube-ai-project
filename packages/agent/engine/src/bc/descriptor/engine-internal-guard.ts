import {
  ENGINE_INTERNAL_DESCRIPTOR_ERROR_CODE,
  findEngineInternalRefsInAgentContent,
  formatEngineInternalRefViolations,
  isEngineInternalAgentRef,
  isEngineInternalLibraryRef,
  type TenantAgentContent,
  type TenantDescriptorKind,
} from "@cube-ai/contracts";

import { AgenticEngineError } from "../../infra/errors/agentic-error";

export function assertUserSessionAgentId(agentId: string): void {
  if (isEngineInternalAgentRef(agentId)) {
    throw AgenticEngineError.fromCode(
      ENGINE_INTERNAL_DESCRIPTOR_ERROR_CODE,
      `Engine-internal agent cannot be used in user sessions: ${agentId}`,
      { agentId, ref: agentId },
    );
  }
}

export function assertUserShelfInstallAllowed(kind: "agent" | "skill", ref: string): void {
  if (isEngineInternalLibraryRef(kind, ref)) {
    throw AgenticEngineError.fromCode(
      ENGINE_INTERNAL_DESCRIPTOR_ERROR_CODE,
      `Engine-internal ${kind} cannot be installed to user shelf: ${ref}`,
      { kind, ref },
    );
  }
}

export function assertUserAgentContentIsolated(content: TenantAgentContent): void {
  const violations = findEngineInternalRefsInAgentContent(content);
  if (violations.length === 0) {
    return;
  }
  throw AgenticEngineError.fromCode(
    ENGINE_INTERNAL_DESCRIPTOR_ERROR_CODE,
    `User agent content must not reference engine-internal descriptors: ${formatEngineInternalRefViolations(violations)}`,
    { violations },
  );
}

export function assertUserDescriptorContentIsolated(kind: TenantDescriptorKind, content: unknown): void {
  if (kind !== "agent") {
    return;
  }
  assertUserAgentContentIsolated(content as TenantAgentContent);
}

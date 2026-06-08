import type { ToolDescriptor as CubeToolDescriptor } from '@cube-ai/contracts';
import type { ToolDescriptor as TachuToolDescriptor } from '@tachu/core';

function mapSideEffect(d: CubeToolDescriptor): TachuToolDescriptor['sideEffect'] {
  for (const s of d.meta.sideEffects ?? []) {
    if (/irreversible/i.test(s)) return 'irreversible';
    if (/invoke|mutat|delete|:\s*write|write:/i.test(s)) return 'write';
  }
  return 'readonly';
}

function mapRequiresApproval(meta: CubeToolDescriptor['meta']): boolean {
  return meta.consent !== 'NEVER';
}

function mapConsumes(
  d: CubeToolDescriptor,
): TachuToolDescriptor['consumes'] | undefined {
  const consumes = d.consumes;
  if (!consumes) return undefined;
  const kinds = consumes.kinds && consumes.kinds.length > 0 ? new Set(consumes.kinds) : undefined;
  if (kinds === undefined && consumes.required === undefined) return undefined;
  return {
    ...(kinds ? { kinds } : {}),
    ...(consumes.required !== undefined ? { required: consumes.required } : {}),
  };
}

/**
 * 将引擎侧 `ToolDescriptor`（contracts）转为 `@tachu/core` 规划 / tool-use 所需形态。
 */
export function mapContractToolToTachu(d: CubeToolDescriptor): TachuToolDescriptor {
  const inputSchema =
    d.inputSchema && typeof d.inputSchema === 'object' && !Array.isArray(d.inputSchema)
      ? (d.inputSchema as Record<string, unknown>)
      : {};
  const outputSchema =
    d.outputSchema && typeof d.outputSchema === 'object' && !Array.isArray(d.outputSchema)
      ? (d.outputSchema as Record<string, unknown>)
      : undefined;
  const consumes = mapConsumes(d);
  return {
    kind: 'tool',
    name: d.name,
    description: (d.description?.trim().length ? d.description : d.displayName) ?? d.name,
    version: d.version ?? '1.0.0',
    displayName: d.displayName,
    ...(d.tags && d.tags.length > 0 ? { tags: [...d.tags] } : {}),
    sideEffect: mapSideEffect(d),
    idempotent: d.meta.idempotent,
    requiresApproval: mapRequiresApproval(d.meta),
    timeout: d.meta.timeoutMs,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(consumes ? { consumes } : {}),
    execute: d.execute,
  };
}

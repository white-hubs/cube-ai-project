import { parseTenantDescriptorId, type TenantAgentContent } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import type { DescriptorListingRepository } from './listing.service';
import type { UserShelfRepository } from './shelf.service';
import type { TenantDescriptorRepository } from './tenant-descriptor.repository';

export interface RunnableAgentResolution {
  record: Record<string, unknown>;
  versionNo: number;
}

function notFound(agentRef: string): never {
  throw AgenticEngineError.fromCode(
    'RESOURCE_NOT_FOUND_DESCRIPTOR',
    `Agent descriptor not found: ${agentRef}`,
    { agentRef },
  );
}

function agentRecord(content: unknown): Record<string, unknown> {
  const c = content as TenantAgentContent;
  return {
    instructions: c.prompt,
    prompt: c.prompt,
    ...(c.modelConfig !== undefined ? { modelConfig: c.modelConfig } : {}),
    availableTools: c.availableTools ?? [],
    ruleRefs: c.ruleRefs ?? [],
    skillRefs: c.skillRefs ?? [],
    ...(c.subAgentRefs && c.subAgentRefs.length > 0 ? { subAgentRefs: c.subAgentRefs } : {}),
    ...(typeof c.maxDepth === 'number' ? { maxDepth: c.maxDepth } : {}),
  };
}

export class RunnableAgentResolver {
  constructor(
    private readonly descriptors: TenantDescriptorRepository,
    private readonly listings: DescriptorListingRepository,
    private readonly shelves: UserShelfRepository,
  ) {}

  async resolve(
    tenant: number,
    userId: string,
    agentRef: string,
    opts: { versionNo?: number } = {},
  ): Promise<RunnableAgentResolution> {
    if (parseTenantDescriptorId(agentRef)?.kind !== 'agent') notFound(agentRef);

    const head = await this.descriptors.findById(tenant, agentRef);
    if (!head || head.kind !== 'agent') notFound(agentRef);

    if (head.ownerUserId === userId) {
      if (opts.versionNo !== undefined) {
        const content = await this.descriptors.getVersionContent(tenant, agentRef, opts.versionNo);
        if (content == null) notFound(agentRef);
        return { record: agentRecord(content), versionNo: opts.versionNo };
      }
      return { record: agentRecord(head.content), versionNo: 0 };
    }

    const shelf = await this.shelves.findByTarget(tenant, userId, agentRef);
    if (!shelf?.enabled) notFound(agentRef);
    const listing = await this.listings.get(tenant, agentRef);
    const effectiveVersionNo = shelf.pinVersionNo ?? listing?.sharedVersionNo ?? null;
    if (effectiveVersionNo == null) notFound(agentRef);
    const content = await this.descriptors.getVersionContent(tenant, agentRef, effectiveVersionNo);
    if (content == null) notFound(agentRef);
    return { record: agentRecord(content), versionNo: effectiveVersionNo };
  }
}

import type { OutboxWriter, TransactionContext } from "@cube-ai/bun-server-ext-outbox";
import {
  type DescriptorListingView,
  type LibraryItemView,
  type TenantDescriptorKind,
  filterUserVisibleLibraryItems,
  isEngineInternalLibraryRef,
} from "@cube-ai/contracts";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import { assertDescriptorOwner, assertDescriptorOwnerOrAdmin } from "./descriptor-owner";
import type { TenantDescriptorRepository } from "./tenant-descriptor.repository";

const NULL_TX = null as unknown as TransactionContext;

export interface DescriptorListingRepository {
  get(tenant: number, descriptorId: string): Promise<DescriptorListingView | null>;
  list(tenant: number, descriptorId: string, versionNo: number, actor: string): Promise<DescriptorListingView>;
  unlist(tenant: number, descriptorId: string, actor: string): Promise<DescriptorListingView>;
  /** 库列表：仅元数据，不含 content 正文。 */
  browseListed(tenant: number, kind: "agent" | "skill"): Promise<LibraryItemView[]>;
  /** 库详情：租户已上架项带完整 content。 */
  getListed(tenant: number, kind: "agent" | "skill", ref: string): Promise<LibraryItemView | null>;
}

export interface LibraryBrowseOptions {
  q?: string;
  tier?: "tenant" | "system";
}

export class ListingService {
  constructor(
    private readonly descriptors: TenantDescriptorRepository,
    private readonly listings: DescriptorListingRepository,
    private readonly outbox?: OutboxWriter,
  ) {}

  private async appendDescriptorReload(tenant: number, descriptorId: string): Promise<void> {
    if (!this.outbox) return;
    try {
      await this.outbox.append(NULL_TX, {
        tenant,
        channel: "descriptor_reload",
        eventType: "descriptor.reload",
        payloadJson: { tenant, descriptorId },
        target: descriptorId,
        scheduleTime: Date.now(),
      });
    } catch {
      // POST-commit best-effort：上架/下架已落库，outbox 失败不应把 HTTP 打成 500。
    }
  }

  async list(tenant: number, descriptorId: string, versionNo: number, actor: string): Promise<DescriptorListingView> {
    const descriptor = await this.descriptors.findById(tenant, descriptorId);
    if (!descriptor) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Descriptor not found: ${descriptorId}`, { descriptorId });
    }
    if (descriptor.kind === "rule") {
      throw AgenticEngineError.fromCode("FAILED_PRECONDITION_DESCRIPTOR_KIND_UNLISTABLE", "Rules cannot be listed in the marketplace", {
        descriptorId,
        kind: descriptor.kind,
      });
    }
    assertDescriptorOwner(descriptor.ownerUserId, actor);

    const content = await this.descriptors.getVersionContent(tenant, descriptorId, versionNo);
    if (content == null) {
      throw AgenticEngineError.fromCode(
        "FAILED_PRECONDITION_DESCRIPTOR_VERSION_UNPUBLISHED",
        `Descriptor version is not published: ${descriptorId}@${versionNo}`,
        { descriptorId, versionNo },
      );
    }
    const listed = await this.listings.list(tenant, descriptorId, versionNo, actor);
    await this.appendDescriptorReload(tenant, descriptorId);
    return listed;
  }

  async unlist(tenant: number, descriptorId: string, actor: string, opts: { isAdmin?: boolean } = {}): Promise<DescriptorListingView> {
    const descriptor = await this.descriptors.findById(tenant, descriptorId);
    if (!descriptor) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Descriptor not found: ${descriptorId}`, { descriptorId });
    }
    assertDescriptorOwnerOrAdmin(descriptor.ownerUserId, actor, opts.isAdmin === true);
    const unlisted = await this.listings.unlist(tenant, descriptorId, actor);
    await this.appendDescriptorReload(tenant, descriptorId);
    return unlisted;
  }

  get(tenant: number, descriptorId: string): Promise<DescriptorListingView | null> {
    return this.listings.get(tenant, descriptorId);
  }
}

export interface LibrarySystemSource {
  systemAgents(): Promise<
    Array<{
      name: string;
      displayName?: string;
      description?: string;
      tags?: string[];
      content?: unknown;
    }>
  >;
  systemSkills(): Array<{
    name: string;
    displayName?: string;
    description?: string;
    tags?: string[];
    instructions?: string;
  }>;
}

export class LibraryService {
  constructor(
    private readonly listings: DescriptorListingRepository,
    private readonly systemSource: LibrarySystemSource,
  ) {}

  async browse(tenant: number, kind: Exclude<TenantDescriptorKind, "rule">, opts: LibraryBrowseOptions = {}): Promise<LibraryItemView[]> {
    const tenantItems = await this.listings.browseListed(tenant, kind);
    let items: LibraryItemView[];
    if (kind === "agent") {
      const systemAgents = await this.systemSource.systemAgents();
      items = [
        ...tenantItems,
        ...systemAgents.map((agent) => ({
          ref: agent.name,
          kind: "agent" as const,
          tier: "system" as const,
          ...(agent.displayName ? { displayName: agent.displayName } : {}),
          ...(agent.description ? { description: agent.description } : {}),
          ...(agent.tags ? { tags: agent.tags } : {}),
        })),
      ];
    } else {
      items = [
        ...tenantItems,
        ...this.systemSource.systemSkills().map((skill) => ({
          ref: skill.name,
          kind: "skill" as const,
          tier: "system" as const,
          ...(skill.displayName ? { displayName: skill.displayName } : {}),
          ...(skill.description ? { description: skill.description } : {}),
          ...(skill.tags ? { tags: skill.tags } : {}),
        })),
      ];
    }

    if (opts.tier) items = items.filter((item) => item.tier === opts.tier);
    const q = opts.q?.trim().toLowerCase();
    if (q) {
      items = items.filter((item) => {
        const haystack = [item.ref, item.displayName, item.description, ...(item.tags ?? [])]
          .filter((v): v is string => typeof v === "string")
          .join("\n")
          .toLowerCase();
        return haystack.includes(q);
      });
    }
    return filterUserVisibleLibraryItems(items);
  }

  async get(tenant: number, kind: Exclude<TenantDescriptorKind, "rule">, ref: string): Promise<LibraryItemView> {
    if (isEngineInternalLibraryRef(kind, ref)) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Library item not found: ${ref}`, { ref, kind });
    }
    const listed = await this.listings.getListed(tenant, kind, ref);
    if (listed) {
      return listed;
    }
    const item = (await this.browse(tenant, kind, { tier: "system" })).find((candidate) => candidate.ref === ref);
    if (!item) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Library item not found: ${ref}`, { ref, kind });
    }
    return item;
  }
}

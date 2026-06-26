import { parseTenantDescriptorId, type InstallRequest, type ShelfEntryView, type ShelfPatch } from "@cube-ai/contracts";

import { AgenticEngineError } from "../../infra/errors/agentic-error";
import type { DescriptorListingRepository } from "./listing.service";
import type { TenantDescriptorRepository } from "./tenant-descriptor.repository";

export interface UserShelfRepository {
  listByUser(tenant: number, userId: string, kind: "agent" | "skill"): Promise<ShelfEntryView[]>;
  findByTarget(tenant: number, userId: string, targetId: string): Promise<ShelfEntryView | null>;
  findById(tenant: number, userId: string, shelfId: string): Promise<ShelfEntryView | null>;
  insertRef(
    tenant: number,
    userId: string,
    kind: "agent" | "skill",
    targetId: string,
    pinVersionNo: number | null,
  ): Promise<ShelfEntryView>;
  patch(
    tenant: number,
    userId: string,
    shelfId: string,
    patch: { enabled?: boolean; pinVersionNo?: number | null },
  ): Promise<ShelfEntryView>;
  softDelete(tenant: number, userId: string, shelfId: string): Promise<void>;
  upsertAuthored(tenant: number, userId: string, descriptorId: string, kind: "agent" | "skill"): Promise<ShelfEntryView>;
}

export interface ShelfListOptions {
  enabled?: boolean;
  source?: ShelfEntryView["source"];
}

export class ShelfService {
  constructor(
    private readonly shelves: UserShelfRepository,
    private readonly listings: DescriptorListingRepository,
    private readonly descriptors: TenantDescriptorRepository,
  ) {}

  async list(tenant: number, userId: string, kind: "agent" | "skill", opts: ShelfListOptions = {}): Promise<ShelfEntryView[]> {
    const entries = await this.shelves.listByUser(tenant, userId, kind);
    return entries
      .filter((entry) => opts.enabled === undefined || entry.enabled === opts.enabled)
      .filter((entry) => opts.source === undefined || entry.source === opts.source)
      .map((entry) => this.withRunnableStatus(entry));
  }

  async install(tenant: number, userId: string, kind: "agent" | "skill", req: InstallRequest): Promise<ShelfEntryView> {
    if (req.mode === "copy") {
      throw AgenticEngineError.fromCode("UNIMPLEMENTED_COPY_DESCRIPTOR", "Copy install is not implemented in marketplace v1", {
        ref: req.ref,
      });
    }

    const parsed = parseTenantDescriptorId(req.ref);
    if (parsed) {
      if (parsed.kind !== kind) {
        throw AgenticEngineError.fromCode("INVALID_ARGUMENT_DESCRIPTOR_KIND", `Descriptor ref kind mismatch: ${req.ref}`, {
          ref: req.ref,
          expectedKind: kind,
          actualKind: parsed.kind,
        });
      }
      const listing = await this.listings.get(tenant, req.ref);
      if (!listing?.listed) {
        throw AgenticEngineError.fromCode("FAILED_PRECONDITION_DESCRIPTOR_NOT_LISTED", `Descriptor is not listed: ${req.ref}`, {
          ref: req.ref,
        });
      }
      const descriptor = await this.descriptors.findById(tenant, req.ref);
      if (!descriptor) {
        throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Descriptor not found: ${req.ref}`, { ref: req.ref });
      }
      const existing = await this.shelves.findByTarget(tenant, userId, req.ref);
      if (existing) return this.withRunnableStatus(existing);
      return this.withRunnableStatus(await this.shelves.insertRef(tenant, userId, kind, req.ref, req.pin ? listing.sharedVersionNo : null));
    }

    const existing = await this.shelves.findByTarget(tenant, userId, req.ref);
    if (existing) return this.withRunnableStatus(existing);
    return this.withRunnableStatus(await this.shelves.insertRef(tenant, userId, kind, req.ref, null));
  }

  async patch(tenant: number, userId: string, shelfId: string, patch: ShelfPatch): Promise<ShelfEntryView> {
    const current = await this.shelves.findById(tenant, userId, shelfId);
    if (!current) {
      throw AgenticEngineError.fromCode("RESOURCE_NOT_FOUND_DESCRIPTOR", `Shelf entry not found: ${shelfId}`, { shelfId });
    }
    const next: { enabled?: boolean; pinVersionNo?: number | null } = {};
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.pin !== undefined) {
      next.pinVersionNo = patch.pin ? await this.effectiveVersion(tenant, current) : null;
    }
    return this.withRunnableStatus(await this.shelves.patch(tenant, userId, shelfId, next));
  }

  async remove(tenant: number, userId: string, shelfId: string): Promise<void> {
    await this.shelves.softDelete(tenant, userId, shelfId);
  }

  upsertAuthored(tenant: number, userId: string, descriptorId: string, kind: "agent" | "skill"): Promise<ShelfEntryView> {
    return this.shelves.upsertAuthored(tenant, userId, descriptorId, kind);
  }

  private async effectiveVersion(tenant: number, entry: ShelfEntryView): Promise<number | null> {
    if (entry.pinVersionNo != null) return entry.pinVersionNo;
    const parsed = parseTenantDescriptorId(entry.targetId);
    if (!parsed) return null;
    const listing = await this.listings.get(tenant, entry.targetId).catch(() => null);
    return listing?.sharedVersionNo ?? entry.effectiveVersionNo ?? null;
  }

  private withRunnableStatus(entry: ShelfEntryView): ShelfEntryView {
    if (!entry.enabled) return { ...entry, runnableStatus: "disabled" };
    // Bare system refs (no agt_/skl_ prefix) resolve at runtime via DescriptorLoader, not tenant versions.
    if (!parseTenantDescriptorId(entry.targetId)) {
      return { ...entry, runnableStatus: "runnable" };
    }
    if (entry.effectiveVersionNo == null && entry.source !== "authored") {
      return { ...entry, runnableStatus: "unresolvable" };
    }
    return { ...entry, runnableStatus: "runnable" };
  }
}

import { type Container } from "@dangao/bun-server";
import type { Pool } from "mysql2/promise";

import { isEngineInternalAgentRef, isEngineInternalSkillRef } from "@cube-ai/contracts";

import { MYSQL_POOL_TOKEN } from "../../infra/mysql/mysql.tokens";
import { buildOutboxWriter } from "../../infra/outbox/outbox-factory";
import { sharedSfidService } from "../../infra/sfid/shared-sfid";
import { DescriptorListingRepositoryImpl } from "./descriptor-listing.repository";
import { DescriptorLoader } from "./descriptor-loader";
import { DescriptorRegistryService } from "./descriptor-registry.service";
import { LibraryService, ListingService, type LibrarySystemSource } from "./listing.service";
import { PluginCatalogService } from "./plugin-catalog.service";
import { ShelfService } from "./shelf.service";
import { SkillRegistryService } from "./skill-registry.service";
import { TenantDescriptorRepositoryImpl } from "./tenant-descriptor.repository";
import { UserAvailableToolRepositoryImpl } from "./user-available-tool.repository";
import { UserShelfRepositoryImpl } from "./user-shelf.repository";

function tryResolve<T>(c: Container, token: unknown): T | undefined {
  try {
    return c.resolve(token as never) as T;
  } catch {
    return undefined;
  }
}

function resolvePool(c: Container): Pool | null {
  return tryResolve<Pool | null>(c, MYSQL_POOL_TOKEN) ?? null;
}

function buildSystemSource(c: Container): LibrarySystemSource {
  const loader = tryResolve<DescriptorLoader>(c, DescriptorLoader);
  const skills = tryResolve<SkillRegistryService>(c, SkillRegistryService);
  return {
    systemAgents: async () => {
      const names = loader?.listIndexedAgentNames() ?? [];
      const out: Array<{
        name: string;
        displayName?: string;
        description?: string;
        tags?: string[];
      }> = [];
      for (const name of names) {
        if (isEngineInternalAgentRef(name)) continue;
        const rec = await loader?.getAgent(name);
        if (!rec) continue;
        out.push({
          name,
          ...(typeof rec.displayName === "string" ? { displayName: rec.displayName } : {}),
          ...(typeof rec.description === "string" ? { description: rec.description } : {}),
          ...(Array.isArray(rec.tags) ? { tags: rec.tags.filter((t): t is string => typeof t === "string") } : {}),
        });
      }
      return out;
    },
    systemSkills: () =>
      (skills?.list() ?? [])
        .filter((skill) => !isEngineInternalSkillRef(skill.name))
        .map((skill) => ({
          name: skill.name,
          ...(skill.displayName ? { displayName: skill.displayName } : {}),
          ...(skill.description ? { description: skill.description } : {}),
          ...(skill.tags ? { tags: skill.tags } : {}),
        })),
  };
}

function buildListingRepository(c: Container): DescriptorListingRepositoryImpl {
  return new DescriptorListingRepositoryImpl(resolvePool(c));
}

export function buildListingService(c: Container): ListingService {
  const pool = resolvePool(c);
  const outbox = buildOutboxWriter(pool);
  return new ListingService(new TenantDescriptorRepositoryImpl(pool, sharedSfidService), buildListingRepository(c), outbox);
}

export function buildLibraryService(c: Container): LibraryService {
  return new LibraryService(buildListingRepository(c), buildSystemSource(c));
}

export function buildShelfService(c: Container): ShelfService {
  const pool = resolvePool(c);
  return new ShelfService(
    new UserShelfRepositoryImpl(pool, sharedSfidService),
    buildListingRepository(c),
    new TenantDescriptorRepositoryImpl(pool, sharedSfidService),
    buildSystemSource(c),
  );
}

export function buildPluginCatalogService(c: Container): PluginCatalogService {
  const tools = tryResolve<DescriptorRegistryService>(c, DescriptorRegistryService);
  return new PluginCatalogService(new UserAvailableToolRepositoryImpl(resolvePool(c), sharedSfidService), {
    listAll: () => tools?.listAll() ?? [],
  });
}

export const listingServiceProvider = {
  provide: ListingService,
  useFactory: (c: Container) => buildListingService(c),
};

export const libraryServiceProvider = {
  provide: LibraryService,
  useFactory: (c: Container) => buildLibraryService(c),
};

export const shelfServiceProvider = {
  provide: ShelfService,
  useFactory: (c: Container) => buildShelfService(c),
};

export const pluginCatalogServiceProvider = {
  provide: PluginCatalogService,
  useFactory: (c: Container) => buildPluginCatalogService(c),
};

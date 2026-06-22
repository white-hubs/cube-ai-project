import 'reflect-metadata';
import { Controller, GET, POST, Context, contextStore } from '@dangao/bun-server';
import type { DualSubject } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { isDescriptorAdmin } from './descriptor-owner';
import { LibraryService, ListingService, type LibraryBrowseOptions } from './listing.service';

function requireCtx(): Context {
  const ctx = contextStore.getStore();
  if (!ctx) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_UNKNOWN',
      'Request Context missing — ensure ContextStore middleware is active',
      {},
    );
  }
  return ctx;
}

function readSubject(ctx: Context): DualSubject {
  const subj = (ctx as unknown as { state?: { subject?: DualSubject } }).state?.subject;
  if (!subj?.user?.userId) {
    throw AgenticEngineError.fromCode('UNAUTHENTICATED_TOKEN_INVALID', 'Authentication required', {});
  }
  return subj;
}

function requireId(ctx: Context): string {
  const id = ctx.getParam('id')?.trim();
  if (!id) {
    throw AgenticEngineError.fromCode('INVALID_ARGUMENT_DESCRIPTOR_ID', 'Descriptor id is required', {});
  }
  return id;
}

function requireRef(ctx: Context): string {
  const ref = ctx.getParam('ref')?.trim();
  if (!ref) {
    throw AgenticEngineError.fromCode('INVALID_ARGUMENT_DESCRIPTOR_ID', 'Library ref is required', {});
  }
  return ref;
}

async function jsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = (await ctx.getBody()) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function tenantOf(ctx: Context): number {
  return readSubject(ctx).tenant;
}

function actorOf(ctx: Context): string {
  return readSubject(ctx).user.userId;
}

function descriptorAdminOf(ctx: Context): boolean {
  return isDescriptorAdmin(readSubject(ctx));
}

function libraryBrowseOptions(ctx: Context): LibraryBrowseOptions {
  const q = ctx.query.get('q')?.trim();
  const tierRaw = ctx.query.get('tier')?.trim();
  const opts: LibraryBrowseOptions = {};
  if (q) opts.q = q;
  if (tierRaw) {
    if (tierRaw !== 'tenant' && tierRaw !== 'system') {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'tier must be tenant or system',
        { tier: tierRaw },
      );
    }
    opts.tier = tierRaw;
  }
  return opts;
}

function parsePositiveInt(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw AgenticEngineError.fromCode(
      'INVALID_ARGUMENT_SCHEMA_VIOLATION',
      `${field} must be a positive integer`,
      { [field]: value },
    );
  }
  return n;
}

@Controller('')
export class ListingController {
  constructor(private readonly listing: ListingService) {}

  @POST('/agents/:id/list')
  listAgent() {
    return this.list();
  }

  @POST('/skills/:id/list')
  listSkill() {
    return this.list();
  }

  @POST('/agents/:id/unlist')
  unlistAgent() {
    return this.unlist();
  }

  @POST('/skills/:id/unlist')
  unlistSkill() {
    return this.unlist();
  }

  @GET('/agents/:id/listing')
  getAgentListing() {
    return this.get();
  }

  @GET('/skills/:id/listing')
  getSkillListing() {
    return this.get();
  }

  private async list() {
    const ctx = requireCtx();
    const body = await jsonBody(ctx);
    return this.listing.list(
      tenantOf(ctx),
      requireId(ctx),
      parsePositiveInt(body.versionNo, 'versionNo'),
      actorOf(ctx),
    );
  }

  private async unlist() {
    const ctx = requireCtx();
    return this.listing.unlist(tenantOf(ctx), requireId(ctx), actorOf(ctx), {
      isAdmin: descriptorAdminOf(ctx),
    });
  }

  private get() {
    const ctx = requireCtx();
    return this.listing.get(tenantOf(ctx), requireId(ctx));
  }
}

@Controller('')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @GET('/library/agents')
  async browseAgents() {
    const ctx = requireCtx();
    return { items: await this.library.browse(tenantOf(ctx), 'agent', libraryBrowseOptions(ctx)) };
  }

  @GET('/library/agents/:ref')
  async getAgent() {
    const ctx = requireCtx();
    return this.library.get(tenantOf(ctx), 'agent', requireRef(ctx));
  }

  @GET('/library/skills')
  async browseSkills() {
    const ctx = requireCtx();
    return { items: await this.library.browse(tenantOf(ctx), 'skill', libraryBrowseOptions(ctx)) };
  }

  @GET('/library/skills/:ref')
  async getSkill() {
    const ctx = requireCtx();
    return this.library.get(tenantOf(ctx), 'skill', requireRef(ctx));
  }
}

import 'reflect-metadata';
import { Controller, DELETE, GET, PATCH, POST, Context, contextStore } from '@dangao/bun-server';
import {
  InstallRequestSchema,
  ShelfPatchSchema,
  type DualSubject,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { ShelfService, type ShelfListOptions } from './shelf.service';

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

function requireShelfId(ctx: Context): string {
  const id = ctx.getParam('sheId')?.trim();
  if (!id) {
    throw AgenticEngineError.fromCode('INVALID_ARGUMENT_DESCRIPTOR_ID', 'Shelf id is required', {});
  }
  return id;
}

async function jsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = (await ctx.getBody()) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

function shelfListOptions(ctx: Context): ShelfListOptions {
  const enabledRaw = ctx.query.get('enabled')?.trim();
  const sourceRaw = ctx.query.get('source')?.trim();
  const opts: ShelfListOptions = {};
  if (enabledRaw) {
    if (enabledRaw !== 'true' && enabledRaw !== 'false') {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'enabled must be true or false',
        { enabled: enabledRaw },
      );
    }
    opts.enabled = enabledRaw === 'true';
  }
  if (sourceRaw) {
    if (sourceRaw !== 'authored' && sourceRaw !== 'ref' && sourceRaw !== 'copy') {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'source must be authored, ref, or copy',
        { source: sourceRaw },
      );
    }
    opts.source = sourceRaw;
  }
  return opts;
}

@Controller('')
export class MyShelfController {
  constructor(private readonly shelf: ShelfService) {}

  @GET('/my/agents')
  listAgents() {
    return this.list('agent');
  }

  @GET('/my/skills')
  listSkills() {
    return this.list('skill');
  }

  @POST('/my/agents')
  installAgent() {
    return this.install('agent');
  }

  @POST('/my/skills')
  installSkill() {
    return this.install('skill');
  }

  @PATCH('/my/agents/:sheId')
  patchAgent() {
    return this.patch();
  }

  @PATCH('/my/skills/:sheId')
  patchSkill() {
    return this.patch();
  }

  @DELETE('/my/agents/:sheId')
  removeAgent() {
    return this.remove();
  }

  @DELETE('/my/skills/:sheId')
  removeSkill() {
    return this.remove();
  }

  private async list(kind: 'agent' | 'skill') {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    return { items: await this.shelf.list(subject.tenant, subject.user.userId, kind, shelfListOptions(ctx)) };
  }

  private async install(kind: 'agent' | 'skill') {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    const parsed = InstallRequestSchema.parse(await jsonBody(ctx));
    return this.shelf.install(subject.tenant, subject.user.userId, kind, parsed);
  }

  private async patch() {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    const parsed = ShelfPatchSchema.parse(await jsonBody(ctx));
    return this.shelf.patch(subject.tenant, subject.user.userId, requireShelfId(ctx), parsed);
  }

  private async remove() {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    await this.shelf.remove(subject.tenant, subject.user.userId, requireShelfId(ctx));
    ctx.setStatus(204);
    return undefined;
  }
}

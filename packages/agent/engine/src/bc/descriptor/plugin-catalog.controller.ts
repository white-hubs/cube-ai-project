import 'reflect-metadata';
import { Controller, DELETE, GET, PATCH, POST, Context, contextStore } from '@dangao/bun-server';
import { InstallToolRequestSchema, type DualSubject } from '@cube-ai/contracts';
import { z } from 'zod';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { PluginCatalogService } from './plugin-catalog.service';

const ToolPatchSchema = z.object({ enabled: z.boolean() });

function requireCtx(): Context {
  const ctx = contextStore.getStore();
  if (!ctx) throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Request Context missing', {});
  return ctx;
}

function readSubject(ctx: Context): DualSubject {
  const subj = (ctx as unknown as { state?: { subject?: DualSubject } }).state?.subject;
  if (!subj?.user?.userId) {
    throw AgenticEngineError.fromCode('UNAUTHENTICATED_TOKEN_INVALID', 'Authentication required', {});
  }
  return subj;
}

function requireToolName(ctx: Context): string {
  const name = ctx.getParam('toolName')?.trim();
  if (!name) {
    throw AgenticEngineError.fromCode('INVALID_ARGUMENT_DESCRIPTOR_NAME', 'Tool name is required', {});
  }
  return name;
}

async function jsonBody(ctx: Context): Promise<Record<string, unknown>> {
  const body = (await ctx.getBody()) as unknown;
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

@Controller('')
export class PluginCatalogController {
  constructor(private readonly plugins: PluginCatalogService) {}

  @GET('/plugins')
  async catalog() {
    const ctx = requireCtx();
    const s = readSubject(ctx);
    return { items: await this.plugins.catalog(s.tenant, s.user.userId) };
  }

  @GET('/my/tools')
  async myTools() {
    const ctx = requireCtx();
    const s = readSubject(ctx);
    return { items: await this.plugins.myTools(s.tenant, s.user.userId) };
  }

  @POST('/my/tools')
  async installTool() {
    const ctx = requireCtx();
    const s = readSubject(ctx);
    return this.plugins.install(
      s.tenant,
      s.user.userId,
      InstallToolRequestSchema.parse(await jsonBody(ctx)),
    );
  }

  @PATCH('/my/tools/:toolName')
  async patchTool() {
    const ctx = requireCtx();
    const s = readSubject(ctx);
    return this.plugins.patch(
      s.tenant,
      s.user.userId,
      requireToolName(ctx),
      ToolPatchSchema.parse(await jsonBody(ctx)),
    );
  }

  @DELETE('/my/tools/:toolName')
  async removeTool() {
    const ctx = requireCtx();
    const s = readSubject(ctx);
    await this.plugins.remove(s.tenant, s.user.userId, requireToolName(ctx));
    ctx.setStatus(204);
    return undefined;
  }
}

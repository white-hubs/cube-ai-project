import 'reflect-metadata';
import { Controller, GET, POST, contextStore, type Context } from '@dangao/bun-server';
import { z } from 'zod';
import type { DualSubject } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { LocalFileService } from './local-file.service';

const UploadBodySchema = z.object({
  fileName: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).max(128),
  base64: z.string().min(1),
});

function requireCtx(): Context {
  const ctx = contextStore.getStore();
  if (!ctx) {
    throw AgenticEngineError.fromCode('INTERNAL_UNKNOWN', 'Request Context missing — ensure ContextStore middleware is active', {});
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

@Controller('/files')
export class LocalFileController {
  constructor(private readonly files: LocalFileService) {}

  @POST('/')
  async upload(): Promise<unknown> {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    const rawBody = await ctx.getBody();
    const parsed = UploadBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'file upload body validation failed',
        { issues: parsed.error.issues },
      );
    }
    const bytes = Uint8Array.from(Buffer.from(parsed.data.base64, 'base64'));
    return this.files.upload({
      tenant: subject.tenant,
      uploaderUserId: subject.user.userId,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      bytes,
    });
  }

  @GET('/:fileId/preview')
  async preview(): Promise<Response> {
    const ctx = requireCtx();
    const subject = readSubject(ctx);
    const fileId = ctx.getParam('fileId') ?? '';
    return this.files.buildPreviewResponse(fileId, {
      tenant: subject.tenant,
      userId: subject.user.userId,
    });
  }
}


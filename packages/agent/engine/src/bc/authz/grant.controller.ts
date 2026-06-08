import { Controller, POST, Context, contextStore } from '@dangao/bun-server';
import { GrantResponseRequestSchema } from '@cube-ai/contracts';
import type { DualSubject } from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import { GrantService } from './grant.service';

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

function resolveTtlSeconds(input: {
  scopeChoice?: 'ONCE' | 'SESSION' | 'PERSISTENT';
  rememberTtlSeconds?: number;
}): number | undefined {
  if (input.rememberTtlSeconds != null) return input.rememberTtlSeconds;
  if (input.scopeChoice === 'ONCE') return 60;
  if (input.scopeChoice === 'SESSION') return 3600;
  if (input.scopeChoice === 'PERSISTENT') return 30 * 24 * 3600;
  return undefined;
}

@Controller('/v1/grants')
export class GrantController {
  constructor(private readonly grantService: GrantService) {}

  @POST('/responses')
  async respond(): Promise<void> {
    const ctx = requireCtx();
    const rawBody = await ctx.getBody();
    const parsed = GrantResponseRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'grant response body validation failed',
        { issues: parsed.error.issues },
      );
    }
    const subject = readSubject(ctx);
    if (parsed.data.decision === 'APPROVE') {
      await this.grantService.approveGrant(parsed.data.grantRequestId, undefined, {
        tenant: subject.tenant,
        userId: subject.user.userId,
        ttlSeconds: resolveTtlSeconds(parsed.data),
      });
    } else {
      await this.grantService.denyGrant(
        parsed.data.grantRequestId,
        parsed.data.note ?? 'DENY',
        { tenant: subject.tenant },
      );
    }
    ctx.setStatus(204);
  }
}


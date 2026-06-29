import {
  CONTEXT_SERVICE_TOKEN,
  type Context,
  ContextService,
  Inject,
  Injectable,
  type Middleware,
  type NextFunction,
} from "@dangao/bun-server";

export interface SessionContext {
  uri: string;
  host: string;
  domain: string | null;
  authorization: string | null;
  tenant: number | string | null;
  terminal: string | null;
  version?: string | null;
  signature?: string | null;
  permission?: string | null;
  requester?: Record<string, unknown> | null;
}

@Injectable()
export class SessionContextHolder {
  public constructor(
    @Inject(CONTEXT_SERVICE_TOKEN)
    private readonly contextService: ContextService,
  ) {}

  private getRawContext(): Record<string, unknown> | undefined {
    return this.contextService.getContext() as Record<string, unknown> | undefined;
  }

  public getContext(): SessionContext | undefined {
    return this.getRawContext()?.sessionContext as SessionContext | undefined;
  }

  public setContext(context: SessionContext): void {
    const rawContext = this.getRawContext();
    if (rawContext) {
      (rawContext as { sessionContext?: SessionContext }).sessionContext = context;
    }
  }

  public clearContext(): void {
    const rawContext = this.getRawContext() as { sessionContext?: SessionContext } | undefined;
    if (rawContext && "sessionContext" in rawContext) {
      delete rawContext.sessionContext;
    }
  }
}

export const sessionContextHolder = new SessionContextHolder(new ContextService());

export function createSessionContextMiddleware(holder: SessionContextHolder): Middleware {
  return async (ctx: Context, next: NextFunction) => {
    try {
      const headers = ctx.request.headers;
      const tenantHeader = headers.get("tenant");
      const tenantFallback = headers.get("x-tenant-id")?.trim() || headers.get("x-project-id")?.trim() || "";
      const tenantRaw = tenantHeader?.trim() ?? tenantFallback;
      const tenant = /^\d+$/u.test(tenantRaw) ? tenantRaw : null;
      const session: SessionContext = {
        authorization: headers.get("authorization"),
        domain: headers.get("host"),
        host: ctx.getClientIp(),
        permission: headers.get("permission") ?? null,
        signature: headers.get("signature") ?? null,
        tenant,
        terminal: headers.get("terminal") ?? null,
        uri: ctx.path,
        version: headers.get("version") ?? null,
      };
      holder.setContext(session);
      return await next();
    } finally {
      holder.clearContext();
    }
  };
}

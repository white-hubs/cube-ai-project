import { CONTEXT_SERVICE_TOKEN, ContextService, Inject, Injectable, type Context, type Middleware, type NextFunction } from '@dangao/bun-server'

export interface SessionContext {
  uri: string
  host: string
  domain: string | null
  authorization: string | null
  tenant: number | string | null
  terminal: string | null
  version?: string | null
  signature?: string | null
  permission?: string | null
  requester?: Record<string, unknown> | null
}

@Injectable()
export class SessionContextHolder {
  public constructor(
    @Inject(CONTEXT_SERVICE_TOKEN)
    private readonly contextService: ContextService,
  ) {}

  private getRawContext(): Record<string, unknown> | undefined {
    return this.contextService.getContext() as Record<string, unknown> | undefined
  }

  public getContext(): SessionContext | undefined {
    return this.getRawContext()?.sessionContext as SessionContext | undefined
  }

  public setContext(context: SessionContext): void {
    const rawContext = this.getRawContext()
    if (rawContext) {
      ;(rawContext as { sessionContext?: SessionContext }).sessionContext = context
    }
  }

  public clearContext(): void {
    const rawContext = this.getRawContext() as { sessionContext?: SessionContext } | undefined
    if (rawContext && 'sessionContext' in rawContext) {
      delete rawContext.sessionContext
    }
  }
}

export const sessionContextHolder = new SessionContextHolder(new ContextService())

export function createSessionContextMiddleware(holder: SessionContextHolder): Middleware {
  return async (ctx: Context, next: NextFunction) => {
    try {
      const headers = ctx.request.headers
      const tenantHeader = headers.get('tenant')
      const tenantRaw = tenantHeader?.trim() ?? ''
      const tenant = /^\d+$/.test(tenantRaw) ? tenantRaw : null
      const session: SessionContext = {
        uri: ctx.path,
        host: ctx.getClientIp(),
        domain: headers.get('host'),
        authorization: headers.get('authorization'),
        tenant,
        terminal: headers.get('terminal') ?? null,
        version: headers.get('version') ?? null,
        signature: headers.get('signature') ?? null,
        permission: headers.get('permission') ?? null,
      }
      holder.setContext(session)
      return await next()
    } finally {
      holder.clearContext()
    }
  }
}

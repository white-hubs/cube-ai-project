import { CONTEXT_SERVICE_TOKEN, ContextService, Inject, Injectable } from "@dangao/bun-server";

export enum PrincipalType {
  USER = "USER",
  CLIENT = "CLIENT",
}

export interface Principal {
  id: number;
  type: PrincipalType;
  admin: boolean;
  name: string;
  account: string;
}

export interface SecurityContext {
  principal: Principal;
  payload?: Record<string, unknown>;
}

@Injectable()
export class SecurityContextHolder {
  public constructor(
    @Inject(CONTEXT_SERVICE_TOKEN)
    private readonly contextService: ContextService,
  ) {}

  private getRawContext(): Record<string, unknown> | undefined {
    return this.contextService.getContext() as Record<string, unknown> | undefined;
  }

  public getContext(): SecurityContext | undefined {
    return this.getRawContext()?.securityContext as SecurityContext | undefined;
  }

  public getPrincipal(): Principal | undefined {
    return this.getContext()?.principal;
  }

  public getRequiredPrincipal(): Principal {
    const principal = this.getPrincipal();
    if (!principal) {
      throw new Error("SecurityContextHolder: principal is missing in current request context");
    }
    return principal;
  }

  public setContext(context: SecurityContext): void {
    const rawContext = this.getRawContext();
    if (rawContext) {
      (rawContext as { securityContext?: SecurityContext }).securityContext = context;
    }
  }

  public clearContext(): void {
    const rawContext = this.getRawContext() as { securityContext?: SecurityContext } | undefined;
    if (rawContext && "securityContext" in rawContext) {
      delete rawContext.securityContext;
    }
  }
}

export const securityContextHolder = new SecurityContextHolder(new ContextService());

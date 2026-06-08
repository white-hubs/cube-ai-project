/**
 * DualSubjectService — extracts and validates dual-principal identity.
 *
 * ref: docs/detailed-design/04-auth-and-authz/oauth2-flow.md §5.1
 *      P3-02-auth-oauth2 §3.3
 */
import { createHash } from 'node:crypto';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import {
  CachedTokenStateSchema,
  DualSubjectSchema,
  OAuth2IntrospectResponseSchema,
  type CachedTokenState,
  type DualSubject,
  type OAuth2IntrospectResponse,
} from '@cube-ai/contracts';

export class DualSubjectService {
  sha256Hex(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /**
   * Build DualSubject from Redis-cached introspection snapshot.
   */
  fromCachedTokenState(
    cached: CachedTokenState,
    rawToken: string,
    headers: {
      xTenantId?: string;
      xTerminal?: string;
      xTraceId?: string;
    },
  ): DualSubject {
    const parsed = CachedTokenStateSchema.parse(cached);
    if (!parsed.active) {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_REVOKED',
        'Cached token state is inactive (token_revoked)',
      );
    }

    const rawTokenSha256 = this.sha256Hex(rawToken);
    const tenant = parsed.tenant;
    const userId = parsed.userId;
    const expMs = parsed.exp ?? Date.now() + 3600_000;

    if (!tenant || !userId) {
      throw AgenticEngineError.fromCode(
        'INTERNAL_UNKNOWN',
        'Cached token state missing tenant/userId — ref CachedTokenState schema',
      );
    }

    if (headers.xTenantId && String(tenant) !== headers.xTenantId) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_TENANT_MISMATCH',
        `X-Tenant-Id ${headers.xTenantId} does not match cached tenant`,
      );
    }

    if (headers.xTerminal && parsed.terminal && headers.xTerminal !== parsed.terminal) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_TERMINAL_MISMATCH',
        `X-Terminal ${headers.xTerminal} does not match cached terminal`,
      );
    }

    const subject = {
      user: {
        userId,
        tenant,
        displayName: '',
        scopes: parsed.scopes,
        rawTokenSha256,
        expiresAt: expMs,
      },
      tenant,
      traceId: headers.xTraceId ?? `trace-${Date.now()}`,
      terminal: parsed.terminal ?? headers.xTerminal,
    };

    return DualSubjectSchema.parse(subject);
  }

  /**
   * Build DualSubject from a successful OAuth2 introspection response + raw token.
   */
  fromIntrospectResponse(
    responseRaw: unknown,
    rawToken: string,
    headers: {
      xTenantId?: string;
      xTerminal?: string;
      xTraceId?: string;
    },
  ): DualSubject {
    const response = OAuth2IntrospectResponseSchema.parse(responseRaw) as OAuth2IntrospectResponse;

    if (!response.active) {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_REVOKED',
        'Token is not active',
      );
    }

    const userId =
      response.user_name ?? response.username ?? response.sub;
    if (!userId) {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_INVALID',
        'Missing user identifier in token claims',
      );
    }

    if (!response.tenant_id) {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_INVALID',
        'Missing tenant_id in token claims (UNAUTHENTICATED_TENANT_MISSING)',
      );
    }

    const tenant = parseInt(response.tenant_id, 10);
    if (!Number.isInteger(tenant) || tenant <= 0) {
      throw AgenticEngineError.fromCode(
        'UNAUTHENTICATED_TOKEN_INVALID',
        `Invalid tenant_id value: ${response.tenant_id}`,
      );
    }

    if (headers.xTenantId && headers.xTenantId !== response.tenant_id) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_TENANT_MISMATCH',
        `X-Tenant-Id ${headers.xTenantId} does not match token tenant_id`,
      );
    }

    if (
      headers.xTerminal &&
      response.terminal &&
      headers.xTerminal !== response.terminal
    ) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_TERMINAL_MISMATCH',
        `X-Terminal ${headers.xTerminal} does not match token terminal`,
      );
    }

    const scopes = response.scope
      ? response.scope.split(' ').filter(Boolean)
      : [];

    const rawTokenSha256 = this.sha256Hex(rawToken);
    const expiresAt = response.exp ? response.exp * 1000 : Date.now() + 3600_000;

    const audList = Array.isArray(response.aud)
      ? response.aud
      : response.aud
        ? [response.aud]
        : [];

    const service =
      response.client_id || audList[0]
        ? {
            clientId: response.client_id ?? audList[0] ?? 'unknown-client',
            scopes,
            expiresAt,
          }
        : undefined;

    const subject = {
      user: {
        userId,
        tenant,
        displayName: '',
        scopes,
        rawTokenSha256,
        expiresAt,
      },
      service,
      tenant,
      traceId: headers.xTraceId ?? `trace-${Date.now()}`,
      terminal: response.terminal ?? headers.xTerminal,
      tokenJti: response.jti,
    };

    return DualSubjectSchema.parse(subject);
  }
}

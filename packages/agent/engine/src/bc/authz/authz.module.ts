/**
 * AuthZ BC module — Grant cache + Consent DSL + Authorization Gateway.
 *
 * ref: docs/detailed-design/04-auth-and-authz/authorization-gateway.md
 *      docs/technical-design/prompts/phase-3/P3-03-authz.md
 */
import { Module } from '@dangao/bun-server';
import { createPool, type Pool } from 'mysql2/promise';
import Redis from 'ioredis';
import { SessionSseEmitter, SseExtModule } from '@cube-ai/bun-server-ext-sse';
import { SfidModule } from '../../infra/sfid/sfid.module';
import { SfidService } from '../../infra/sfid/sfid.service';
import { createMysqlPoolFromEnv } from '../../infra/mysql/mysql-pool.factory';
import { GrantService, createGrantRepository } from './grant.service';
import { GrantController } from './grant.controller';
import { bridgeGrantRequestToSse } from './grant-sse-bridge';
import { ConsentPolicyEngine } from './consent-policy.engine';
import { TrustAgreementRegistry } from './trust-agreement.registry';
import { AuthzGatewayService } from './authz-gateway.service';

/** 仅 AuthZ BC 内部使用的 MySQL pool（无 DSN 时为 null） */
const AUTHZ_MYSQL_POOL = Symbol.for('agentic.authz.mysqlPool');

export const AUTHZ_TOKENS = {
  GRANT_SERVICE: Symbol.for('agentic.authz.grantService'),
  CONSENT_POLICY_ENGINE: Symbol.for('agentic.authz.consentPolicyEngine'),
  AUTHZ_GATEWAY: Symbol.for('agentic.authz.authzGateway'),
  TRUST_REGISTRY: Symbol.for('agentic.authz.trustRegistry'),
  REDIS_CLIENT: Symbol.for('agentic.authz.redisClient'),
} as const;

/** @dangao/bun-server passes the DI container as the sole argument to useFactory. */
type DiContainer = { resolve: (token: unknown) => unknown };

function createAuthzMysqlPoolFromEnv(): Pool | null {
  const fromUrl = createMysqlPoolFromEnv();
  if (fromUrl) return fromUrl;
  const dsn = process.env.AGENTIC_ENGINE_MYSQL_DSN?.trim();
  if (!dsn) return null;
  return createPool({
    uri: dsn,
    waitForConnections: true,
    connectionLimit: 8,
    supportBigNumbers: true,
    bigNumberStrings: true,
  });
}

@Module({
  imports: [SfidModule, SseExtModule],
  providers: [
    {
      provide: AUTHZ_MYSQL_POOL,
      useFactory: (): Pool | null => createAuthzMysqlPoolFromEnv(),
    },
    {
      provide: AUTHZ_TOKENS.REDIS_CLIENT,
      useFactory: (): Redis | null => {
        const url = process.env.AGENTIC_ENGINE_REDIS_URL;
        if (!url) return null;
        return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
      },
    },
    {
      provide: AUTHZ_TOKENS.GRANT_SERVICE,
      useFactory: (c: DiContainer) => {
        const sfid = c.resolve(SfidService) as SfidService;
        const redis = c.resolve(AUTHZ_TOKENS.REDIS_CLIENT) as Redis | null;
        const pool = c.resolve(AUTHZ_MYSQL_POOL) as Pool | null;
        const sseEmitter = c.resolve(SessionSseEmitter) as SessionSseEmitter;
        return new GrantService({
          repository: createGrantRepository(pool),
          redis,
          sfid,
          onGrantRequest: (evt) => {
            void bridgeGrantRequestToSse(sseEmitter, evt);
          },
          enableInvalidationSubscriber: Boolean(redis),
        });
      },
    },
    {
      provide: GrantService,
      useFactory: (c: DiContainer) =>
        c.resolve(AUTHZ_TOKENS.GRANT_SERVICE) as GrantService,
    },
    { provide: AUTHZ_TOKENS.CONSENT_POLICY_ENGINE, useClass: ConsentPolicyEngine },
    { provide: AUTHZ_TOKENS.TRUST_REGISTRY, useClass: TrustAgreementRegistry },
    {
      provide: AUTHZ_TOKENS.AUTHZ_GATEWAY,
      useFactory: (c: DiContainer) => {
        const grantService = c.resolve(AUTHZ_TOKENS.GRANT_SERVICE) as GrantService;
        const consentEngine = c.resolve(AUTHZ_TOKENS.CONSENT_POLICY_ENGINE) as ConsentPolicyEngine;
        return new AuthzGatewayService(grantService, consentEngine);
      },
    },
    GrantController,
  ],
  controllers: [GrantController],
  exports: [
    AUTHZ_TOKENS.GRANT_SERVICE,
    AUTHZ_TOKENS.CONSENT_POLICY_ENGINE,
    AUTHZ_TOKENS.AUTHZ_GATEWAY,
    AUTHZ_TOKENS.TRUST_REGISTRY,
    AUTHZ_TOKENS.REDIS_CLIENT,
  ],
})
export class AuthzModule {}

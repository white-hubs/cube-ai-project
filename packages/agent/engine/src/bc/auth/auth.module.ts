/**
 * Auth BC module — OAuth2 AuthN + Mock OBO.
 *
 * ref: docs/detailed-design/04-auth-and-authz/README.md §4
 */
import { Module } from '@dangao/bun-server';
import Redis from 'ioredis';
import { DualSubjectService } from './dual-subject.service';
import { MockOboJwksController } from './mock-obo-jwks.controller';
import { AUTH_TOKENS } from './auth.tokens';
import { getAuthRedisClient } from './auth-redis';
import { getSharedMockOboService } from './mock-obo.service';

function redisFactory(): Redis | null {
  return getAuthRedisClient();
}

@Module({
  controllers: [MockOboJwksController],
  providers: [
    {
      provide: AUTH_TOKENS.MOCK_OBO_SERVICE,
      useValue: getSharedMockOboService(),
    },
    {
      provide: AUTH_TOKENS.DUAL_SUBJECT_SERVICE,
      useClass: DualSubjectService,
    },
    {
      provide: AUTH_TOKENS.REDIS_CLIENT,
      useFactory: redisFactory,
    },
  ],
  exports: [
    AUTH_TOKENS.MOCK_OBO_SERVICE,
    AUTH_TOKENS.DUAL_SUBJECT_SERVICE,
    AUTH_TOKENS.REDIS_CLIENT,
  ],
})
export class AuthModule {}

export { AUTH_TOKENS };

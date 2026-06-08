/**
 * JWKS endpoint for Mock OBO RS256 verification.
 *
 * ref: trust-agreement.md §4.1 / P3-02-auth-oauth2 §3.4
 */
import { Controller, GET, Inject } from '@dangao/bun-server';
import type { JWK } from 'jose';
import { AUTH_TOKENS } from './auth.tokens';
import { MockOboService } from './mock-obo.service';

@Controller('/.well-known/agentic-engine-mock-obo')
export class MockOboJwksController {
  constructor(
    @Inject(AUTH_TOKENS.MOCK_OBO_SERVICE) private readonly mockObo: MockOboService,
  ) {}

  @GET('/jwks.json')
  async jwks(): Promise<{ keys: JWK[] }> {
    return this.mockObo.getJwksBody();
  }
}

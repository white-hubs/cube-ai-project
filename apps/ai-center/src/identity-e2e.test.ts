import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { Application } from '@dangao/bun-server';
import {
  createTestJwtKeyPair,
  signTestJwt,
} from '@cube-ai/platform-adapter-ghcloud';
import {
  applyAiCenterTestEnv,
  restoreAiCenterTestEnv,
  snapshotAiCenterTestEnv,
} from './test-helpers/ai-center-test-env';

describe('ai-center ghcloud identity e2e', () => {
  let baseUrl = '';
  let app: Application | undefined;
  let server: ReturnType<NonNullable<Application>['getServer']> | undefined;
  let bootstrap: (opts?: { port?: number; hostname?: string }) => Promise<Application>;
  let envSnapshot: Record<string, string | undefined>;
  let jwtServer: ReturnType<typeof Bun.serve> | undefined;
  let bearerToken = '';

  beforeAll(async () => {
    envSnapshot = snapshotAiCenterTestEnv();
    applyAiCenterTestEnv(`${import.meta.dir}/.tmp-ai-center-identity.sqlite`);

    const { privateKey, publicKey, jwk } = await createTestJwtKeyPair();
    bearerToken = await signTestJwt(privateKey, {
      id: 42,
      admin: true,
      name: 'alice',
      account: 'alice@corp',
      tenants: [900001],
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    jwtServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        if (req.url.endsWith('/jwt.key')) {
          return Response.json({ keys: [{ ...jwk, alg: 'RS256', use: 'sig' }] });
        }
        return new Response('not found', { status: 404 });
      },
    });

    process.env.USE_GHCLOUD_IDENTITY = '1';
    process.env.JWT_KEY_URL = `http://127.0.0.1:${jwtServer.port}/jwt.key`;
    void publicKey;

    ({ bootstrap } = await import('./bootstrap'));

    const port = 4300 + Math.floor(Math.random() * 500);
    app = await bootstrap({ port, hostname: '127.0.0.1' });
    server = app.getServer();
    baseUrl = `http://127.0.0.1:${port}`;
  }, 120_000);

  afterAll(async () => {
    await server?.stop?.();
    await jwtServer?.stop(true);
    restoreAiCenterTestEnv(envSnapshot);
    delete process.env.USE_GHCLOUD_IDENTITY;
    delete process.env.JWT_KEY_URL;
  });

  it('accepts RS256 JWT via USE_GHCLOUD_IDENTITY=1 middleware chain', async () => {
    const resp = await fetch(`${baseUrl}/flow/flows`, {
      headers: {
        authorization: `Bearer ${bearerToken}`,
        tenant: '900001',
      },
    });
    expect(resp.status).toBe(200);
    const body = (await resp.json()) as unknown;
    expect(Array.isArray(body)).toBe(true);
  });
});

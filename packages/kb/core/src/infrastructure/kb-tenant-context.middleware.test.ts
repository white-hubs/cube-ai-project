import { describe, expect, test } from 'bun:test';
import { tenantContextAls } from '@cube-ai/tenant-context';
import { createKbTenantContextMiddleware } from './kb-tenant-context.middleware';

function createCtx(path: string, headers: Record<string, string>) {
  return {
    path,
    request: new Request(`http://localhost${path}`, { headers: new Headers(headers) }),
  };
}

describe('kb tenant context middleware', () => {
  test('sets kb tenant ALS from x-project-id on /search routes', async () => {
    const middleware = createKbTenantContextMiddleware();
    let seen = false;

    await middleware(createCtx('/search/by-documents', { 'x-project-id': '58197260' }) as never, async () => {
      seen = tenantContextAls.getStore()?.tenantId === '58197260';
      return new Response();
    });

    expect(seen).toBe(true);
  });

  test('passes through unrelated paths', async () => {
    const middleware = createKbTenantContextMiddleware();
    let passed = false;

    await middleware(createCtx('/flow/flows', { 'x-project-id': '58197260' }) as never, async () => {
      passed = tenantContextAls.getStore() === undefined;
      return new Response();
    });

    expect(passed).toBe(true);
  });
});

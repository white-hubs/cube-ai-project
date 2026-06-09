import { describe, expect, test } from 'bun:test';
import { createDomainPathRewriteMiddleware } from './domain-path-rewrite.middleware';

describe('createDomainPathRewriteMiddleware', () => {
  test('strips /flow prefix before routing', async () => {
    const mw = createDomainPathRewriteMiddleware();
    const ctx = { path: '/flow/flows' } as { path: string };
    await mw(ctx as never, async () => {});
    expect(ctx.path).toBe('/flows');
  });

  test('strips /kb prefix before routing', async () => {
    const mw = createDomainPathRewriteMiddleware();
    const ctx = { path: '/kb/documents' } as { path: string };
    await mw(ctx as never, async () => {});
    expect(ctx.path).toBe('/documents');
  });

  test('strips /agent prefix before routing', async () => {
    const mw = createDomainPathRewriteMiddleware();
    const ctx = { path: '/agent/sessions' } as { path: string };
    await mw(ctx as never, async () => {});
    expect(ctx.path).toBe('/sessions');
  });

  test('does not strip /llm prefix (direct controller routing)', async () => {
    const mw = createDomainPathRewriteMiddleware();
    const ctx = { path: '/llm/providers' } as { path: string };
    await mw(ctx as never, async () => {});
    expect(ctx.path).toBe('/llm/providers');
  });

  test('leaves unrelated paths unchanged', async () => {
    const mw = createDomainPathRewriteMiddleware();
    const ctx = { path: '/health/live' } as { path: string };
    await mw(ctx as never, async () => {});
    expect(ctx.path).toBe('/health/live');
  });
});

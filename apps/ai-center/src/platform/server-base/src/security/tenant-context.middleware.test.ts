import { describe, expect, test } from 'bun:test'
import { createTenantContextMiddleware } from './tenant-context.middleware'

function createCtx(path: string, method = 'GET', headers: Record<string, string> = {}) {
  return {
    path,
    request: new Request(`http://localhost${path}`, { method, headers }),
  }
}

describe('tenant context middleware', () => {
  test('allows health subpaths without checking tenant', async () => {
    const middleware = createTenantContextMiddleware()

    let passed = false
    await middleware(createCtx('/health/live') as never, async () => {
      passed = true
    })

    expect(passed).toBe(true)
  })

  test('sets tenant context from tenant header', async () => {
    const middleware = createTenantContextMiddleware()
    let passed = false
    await middleware(
      createCtx('/flows', 'GET', { tenant: '42' }) as never,
      async () => { passed = true },
    )
    expect(passed).toBe(true)
  })

  test('falls back to x-tenant-id header', async () => {
    const middleware = createTenantContextMiddleware()
    let passed = false
    await middleware(
      createCtx('/llm/providers', 'GET', { 'x-tenant-id': '99' }) as never,
      async () => { passed = true },
    )
    expect(passed).toBe(true)
  })

  test('passes through when tenantContextAls already set', async () => {
    const middleware = createTenantContextMiddleware()
    const { tenantContextAls } = await import('@cube-ai/server-shared')
    let passed = false
    await tenantContextAls.run({ tenantId: '7', bypassTenantIsolation: false }, async () => {
      await middleware(createCtx('/llm/providers') as never, async () => {
        passed = true
      })
    })
    expect(passed).toBe(true)
  })

  test('throws BadRequestException when no tenant header and not super admin', async () => {
    const middleware = createTenantContextMiddleware()
    await expect(
      middleware(createCtx('/flows') as never, async () => {}),
    ).rejects.toThrow(/tenant header is required/)
  })
})

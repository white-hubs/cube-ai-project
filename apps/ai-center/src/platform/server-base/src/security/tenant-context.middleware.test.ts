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

  test('sets tenant context from x-tenant-id header', async () => {
    const middleware = createTenantContextMiddleware()
    let passed = false
    await middleware(
      createCtx('/flows', 'GET', { 'x-tenant-id': 'tenant-42' }) as never,
      async () => { passed = true },
    )
    expect(passed).toBe(true)
  })

  test('throws BadRequestException when no x-tenant-id header and not super admin', async () => {
    const middleware = createTenantContextMiddleware()
    await expect(
      middleware(createCtx('/flows') as never, async () => {}),
    ).rejects.toThrow()
  })
})

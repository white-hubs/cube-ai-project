import { describe, expect, test } from 'bun:test'
import { authenticatedUserAls, tenantContextAls } from '@cube-ai/ai-center/platform/server-shared'
import { createExecutionAuthMiddleware } from './execution-auth.middleware'
import type { AccessTokenReader } from './middleware-types'

function createCtx(path: string, headers: Record<string, string>, method = 'POST') {
  const normalized = new Headers(headers)
  return {
    path,
    request: new Request(`http://localhost${path}`, {
      method,
      headers: normalized,
    }),
  }
}

describe('execution auth middleware', () => {
  test('allows /health without bearer token', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
    })
    let passed = false
    await middleware(createCtx('/health', {}, 'GET') as never, async () => {
      passed = true
    })
    expect(passed).toBe(true)
  })

  test('allows run request with bearer token and tenant header', async () => {
    const accessTokenReader: AccessTokenReader = {
      verifyAccessToken(rawToken: string) {
        if (rawToken !== 'good-token') return null
        return {
          userId: 'u1',
          username: 'admin',
          role: 'super_admin',
          isSuperAdmin: true,
        }
      },
    }
    const middleware = createExecutionAuthMiddleware({ accessTokenReader })
    let seenAuth = false
    let seenTenant = false

    await middleware(
      createCtx('/run/flow-1', { authorization: 'Bearer good-token', tenant: '42' }) as never,
      async () => {
        seenAuth = authenticatedUserAls.getStore()?.username === 'admin'
        seenTenant = tenantContextAls.getStore()?.tenantId === '42'
      },
    )

    expect(seenAuth).toBe(true)
    expect(seenTenant).toBe(true)
  })

  test('keeps tenant context across async boundary in bearer flow', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: {
        verifyAccessToken(rawToken: string) {
          if (rawToken !== 'good-token') return null
          return {
            userId: 'u1',
            username: 'admin',
            role: 'super_admin',
            isSuperAdmin: true,
          }
        },
      },
    })

    let seenTenantAfterAwait = false
    await middleware(
      createCtx('/documents/upload', {
        authorization: 'Bearer good-token',
        tenant: '42',
      }) as never,
      async () => {
        await Promise.resolve()
        seenTenantAfterAwait = tenantContextAls.getStore()?.tenantId === '42'
      },
    )

    expect(seenTenantAfterAwait).toBe(true)
  })

  test('rejects request with no bearer token', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
    })

    await expect(
      middleware(createCtx('/run/flow-1', {}) as never, async () => {}),
    ).rejects.toThrow('missing or invalid bearer token')
  })

  test('rejects request with invalid bearer token', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
    })

    await expect(
      middleware(createCtx('/run/flow-1', { authorization: 'Bearer bad-token' }) as never, async () => {}),
    ).rejects.toThrow('missing or invalid bearer token')
  })

  test('super-admin with no tenant gets bypass isolation', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: {
        verifyAccessToken() {
          return {
            userId: 'u1',
            username: 'admin',
            role: 'super_admin',
            isSuperAdmin: true,
          }
        },
      },
    })
    let bypass = false

    await middleware(createCtx('/run/flow-1', { authorization: 'Bearer token' }) as never, async () => {
      bypass = tenantContextAls.getStore()?.bypassTenantIsolation === true
    })

    expect(bypass).toBe(true)
  })

  test('allows knowledge-retrieval callback with builtin x-api-key and x-project-id', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
      builtinSystemApiKey: 'sk_cube_builtin_system_test',
    })
    let seenTenant = false

    await middleware(
      createCtx('/search/by-documents', {
        'x-api-key': 'sk_cube_builtin_system_test',
        'x-project-id': '58197260',
      }) as never,
      async () => {
        seenTenant = tenantContextAls.getStore()?.tenantId === '58197260'
      },
    )

    expect(seenTenant).toBe(true)
  })
})

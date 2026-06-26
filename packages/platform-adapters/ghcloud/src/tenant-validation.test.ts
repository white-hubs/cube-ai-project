import { describe, expect, mock, test } from 'bun:test'
import { contextStore, Context } from '@dangao/bun-server'
import { createSessionContextMiddleware, SessionContextHolder } from './session-context'
import { SecurityContextHolder } from './security-context'
import { createTenantValidationMiddleware } from './tenant-validation'

describe('createTenantValidationMiddleware', () => {
  test('rejects when tenant header is missing', async () => {
    const securityHolder = new SecurityContextHolder({ getContext: () => ({}) } as never)
    const sessionHolder = new SessionContextHolder({ getContext: () => ({}) } as never)
    securityHolder.setContext({
      principal: { id: 1, type: 'USER' as never, admin: false, name: 'u', account: 'u' },
      payload: { tenants: [900001] },
    })

    const middleware = createTenantValidationMiddleware(securityHolder, sessionHolder)

    await expect(
      middleware(
        {
          path: '/llm/providers',
          request: { headers: new Headers() },
        } as never,
        mock(async () => new Response()),
      ),
    ).rejects.toThrow('missing or invalid tenant header')
  })

  test('bypasses tenant validation when bypass predicate matches', async () => {
    const securityHolder = new SecurityContextHolder({ getContext: () => ({}) } as never)
    const sessionHolder = new SessionContextHolder({ getContext: () => ({}) } as never)
    const middleware = createTenantValidationMiddleware(securityHolder, sessionHolder, {
      bypass: (ctx) => (ctx.request.headers.get('x-api-key')?.trim() ?? '') !== '',
    })
    let nextCalled = false

    await middleware(
      {
        path: '/kb/search/by-documents',
        request: {
          headers: new Headers({
            'x-api-key': 'candidate-key',
          }),
        },
      } as never,
      mock(async () => {
        nextCalled = true
        return new Response()
      }),
    )

    expect(nextCalled).toBe(true)
  })

  test('rejects when tenant is not in JWT tenants[]', async () => {
    const rawContext: Record<string, unknown> = {}
    const securityHolder = new SecurityContextHolder({ getContext: () => rawContext } as never)
    const sessionHolder = new SessionContextHolder({ getContext: () => rawContext } as never)
    const sessionMw = createSessionContextMiddleware(sessionHolder)
    const tenantMw = createTenantValidationMiddleware(securityHolder, sessionHolder)

    securityHolder.setContext({
      principal: { id: 1, type: 'USER' as never, admin: false, name: 'u', account: 'u' },
      payload: { tenants: [900001] },
    })

    const req = new Request('http://localhost/llm/providers', {
      headers: { tenant: '900002' },
    })
    const ctx = new Context(req)

    await contextStore.run(ctx, async () => {
      await sessionMw(ctx, async () => {
        await expect(tenantMw(ctx, mock(async () => new Response()))).rejects.toThrow(
          'tenant not in token tenants',
        )
        return new Response()
      })
    })
  })

  test('passes when header tenant matches JWT tenants[]', async () => {
    const rawContext: Record<string, unknown> = {}
    const securityHolder = new SecurityContextHolder({ getContext: () => rawContext } as never)
    const sessionHolder = new SessionContextHolder({ getContext: () => rawContext } as never)
    const sessionMw = createSessionContextMiddleware(sessionHolder)
    const tenantMw = createTenantValidationMiddleware(securityHolder, sessionHolder)

    securityHolder.setContext({
      principal: { id: 1, type: 'USER' as never, admin: false, name: 'u', account: 'u' },
      payload: { tenants: [900001, 900002] },
    })

    const req = new Request('http://localhost/llm/providers', {
      headers: { tenant: '900001' },
    })
    const ctx = new Context(req)
    let nextCalled = false

    await contextStore.run(ctx, async () => {
      await sessionMw(ctx, async () => {
        await tenantMw(ctx, async () => {
          nextCalled = true
          return new Response()
        })
        return new Response()
      })
    })

    expect(nextCalled).toBe(true)
  })
})

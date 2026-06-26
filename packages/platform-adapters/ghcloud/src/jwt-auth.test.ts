import { describe, expect, mock, test } from 'bun:test'
import { contextStore, Context } from '@dangao/bun-server'
import { createJwtAuthMiddleware } from './jwt-auth'
import { createStaticJwtKeyLoader } from './jwt-key-loader'
import { SecurityContextHolder } from './security-context'
import { createTestJwtKeyPair, signTestJwt } from './test-helpers/jwt-test-keys'

describe('createJwtAuthMiddleware', () => {
  test('rejects protected requests when verification key loader is not configured', async () => {
    const holder = new SecurityContextHolder({ getContext: () => ({}) } as never)
    const middleware = createJwtAuthMiddleware({ holder })

    await expect(
      middleware(
        {
          path: '/agent/sessions',
          request: {
            headers: new Headers({
              authorization: 'Bearer header.payload.signature',
            }),
          },
        } as never,
        mock(async () => new Response()),
      ),
    ).rejects.toThrow('JWT verification key loader is required')
  })

  test('bypasses JWT verification when bypass predicate matches', async () => {
    const holder = new SecurityContextHolder({ getContext: () => ({}) } as never)
    const middleware = createJwtAuthMiddleware({
      holder,
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
    expect(holder.getContext()).toBeUndefined()
  })

  test('rejects expired tokens after signature verification', async () => {
    const holder = new SecurityContextHolder({ getContext: () => ({}) } as never)
    const middleware = createJwtAuthMiddleware({
      holder,
      keyLoader: {
        getVerificationKey: mock(async () => ({}) as never),
      },
      verifyJwt: mock(async () => ({
        id: 1001,
        tenants: [900001],
        exp: Math.floor(Date.now() / 1000) - 60,
      })),
    })

    await expect(
      middleware(
        {
          path: '/agent/sessions',
          request: {
            headers: new Headers({
              authorization: 'Bearer signed-token',
            }),
          },
        } as never,
        mock(async () => new Response()),
      ),
    ).rejects.toThrow('token expired')
  })

  test('accepts valid RS256 JWT signed with mock key pair', async () => {
    const { privateKey, publicKey } = await createTestJwtKeyPair()
    const token = await signTestJwt(privateKey, {
      id: 42,
      admin: true,
      name: 'alice',
      account: 'alice@corp',
      tenants: [900001],
      exp: Math.floor(Date.now() / 1000) + 3600,
    })

    const rawContext: Record<string, unknown> = {}
    const holder = new SecurityContextHolder({
      getContext: () => rawContext,
    } as never)
    const middleware = createJwtAuthMiddleware({
      holder,
      keyLoader: createStaticJwtKeyLoader(publicKey),
    })

    const req = new Request('http://localhost/agent/sessions', {
      headers: {
        authorization: `Bearer ${token}`,
        tenant: '900001',
      },
    })
    const ctx = new Context(req)
    let nextCalled = false

    await contextStore.run(ctx, async () => {
      await middleware(ctx, async () => {
        nextCalled = true
        const security = holder.getContext()
        expect(security?.principal.id).toBe(42)
        expect(security?.principal.admin).toBe(true)
        expect(security?.payload?.tenants).toEqual([900001])
        return new Response()
      })
    })

    expect(nextCalled).toBe(true)
  })
})

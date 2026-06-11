import { describe, expect, mock, test } from 'bun:test'
import { createSessionContextMiddleware, SessionContextHolder } from './session-context'

function fakeCtx(headers: Record<string, string>, path = '/agent/sessions') {
  return {
    path,
    getClientIp: () => '10.1.2.3',
    request: { headers: new Headers(headers) },
  } as never
}

describe('createSessionContextMiddleware', () => {
  test('parses headers into session context visible during next()', async () => {
    const raw: Record<string, unknown> = {}
    const holder = new SessionContextHolder({ getContext: () => raw } as never)
    const middleware = createSessionContextMiddleware(holder)

    await middleware(
      fakeCtx({
        host: 'api.example.com',
        authorization: 'Bearer tok',
        tenant: '900001',
        terminal: 'web',
        version: '2',
        signature: 'sig',
        permission: 'perm',
      }),
      mock(async () => {
        const session = holder.getContext()
        expect(session).toEqual({
          uri: '/agent/sessions',
          host: '10.1.2.3',
          domain: 'api.example.com',
          authorization: 'Bearer tok',
          tenant: '900001',
          terminal: 'web',
          version: '2',
          signature: 'sig',
          permission: 'perm',
        })
        return new Response()
      }),
    )
  })

  test('falls back to x-tenant-id / x-project-id when tenant header absent', async () => {
    const raw: Record<string, unknown> = {}
    const holder = new SessionContextHolder({ getContext: () => raw } as never)
    const middleware = createSessionContextMiddleware(holder)

    await middleware(
      fakeCtx({ 'x-tenant-id': ' 900007 ' }),
      mock(async () => {
        expect(holder.getContext()?.tenant).toBe('900007')
        return new Response()
      }),
    )

    await middleware(
      fakeCtx({ 'x-project-id': '900008' }),
      mock(async () => {
        expect(holder.getContext()?.tenant).toBe('900008')
        return new Response()
      }),
    )
  })

  test('non-numeric or missing tenant maps to null', async () => {
    const raw: Record<string, unknown> = {}
    const holder = new SessionContextHolder({ getContext: () => raw } as never)
    const middleware = createSessionContextMiddleware(holder)

    await middleware(
      fakeCtx({ tenant: 'evil; DROP TABLE' }),
      mock(async () => {
        expect(holder.getContext()?.tenant).toBeNull()
        return new Response()
      }),
    )

    await middleware(
      fakeCtx({}),
      mock(async () => {
        expect(holder.getContext()?.tenant).toBeNull()
        return new Response()
      }),
    )
  })

  test('clears session context after next resolves and after next throws', async () => {
    const raw: Record<string, unknown> = {}
    const holder = new SessionContextHolder({ getContext: () => raw } as never)
    const middleware = createSessionContextMiddleware(holder)

    await middleware(fakeCtx({ tenant: '900001' }), mock(async () => new Response()))
    expect(holder.getContext()).toBeUndefined()

    await expect(
      middleware(
        fakeCtx({ tenant: '900001' }),
        mock(async () => {
          throw new Error('handler failed')
        }),
      ),
    ).rejects.toThrow('handler failed')
    expect(holder.getContext()).toBeUndefined()
  })
})

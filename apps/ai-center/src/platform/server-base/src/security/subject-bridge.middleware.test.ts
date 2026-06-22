import { describe, expect, test } from 'bun:test'
import { authenticatedUserAls } from '@cube-ai/ai-center/platform/server-shared'
import { createSubjectUserBridgeMiddleware } from './subject-bridge.middleware'

function mockSubject() {
  return {
    user: {
      userId: 'mock-user',
      tenant: 900001,
      displayName: 'Mock User (mock-user)',
      scopes: ['engine.use', 'openid'],
      rawTokenSha256: 'sha',
      expiresAt: Date.now() + 3_600_000,
    },
    tenant: 900001,
    traceId: 'trace-1',
    terminal: 'web',
  }
}

function createCtx(subject: unknown) {
  return {
    path: '/sessions',
    state: { subject },
    request: new Request('http://localhost/sessions', { method: 'POST' }),
  }
}

describe('subject user bridge middleware', () => {
  test('rewrites subject.user.userId + displayName from authenticated ghcloud user', async () => {
    const mw = createSubjectUserBridgeMiddleware()
    const ctx = createCtx(mockSubject())
    let called = false

    await authenticatedUserAls.run(
      { userId: '42', username: 'alice@corp', role: 'admin', isSuperAdmin: true },
      async () => {
        await mw(ctx as never, async () => {
          called = true
        })
      },
    )

    expect(ctx.state.subject.user.userId).toBe('42')
    expect(ctx.state.subject.user.displayName).toBe('alice@corp')
    expect(called).toBe(true)
  })

  test('preserves tenant and scopes while rewriting the user identity', async () => {
    const mw = createSubjectUserBridgeMiddleware()
    const ctx = createCtx(mockSubject())

    await authenticatedUserAls.run(
      { userId: '42', username: 'alice@corp', role: 'admin', isSuperAdmin: true },
      async () => {
        await mw(ctx as never, async () => {})
      },
    )

    expect(ctx.state.subject.user.tenant).toBe(900001)
    expect(ctx.state.subject.tenant).toBe(900001)
    expect(ctx.state.subject.user.scopes).toEqual(['engine.use', 'openid'])
  })

  test('leaves subject untouched when no authenticated user is present', async () => {
    const mw = createSubjectUserBridgeMiddleware()
    const ctx = createCtx(mockSubject())
    let called = false

    await mw(ctx as never, async () => {
      called = true
    })

    expect(ctx.state.subject.user.userId).toBe('mock-user')
    expect(called).toBe(true)
  })
})

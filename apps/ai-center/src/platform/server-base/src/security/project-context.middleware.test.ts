import { describe, expect, test } from 'bun:test'
import { createProjectContextMiddleware } from './project-context.middleware'

function createCtx(path: string, method = 'GET', headers: Record<string, string> = {}) {
  return {
    path,
    request: new Request(`http://localhost${path}`, { method, headers }),
  }
}

describe('project context middleware', () => {
  test('allows health subpaths without checking tenant', async () => {
    const middleware = createProjectContextMiddleware()

    let passed = false
    await middleware(createCtx('/health/live') as never, async () => {
      passed = true
    })

    expect(passed).toBe(true)
  })

  test('sets tenant context from x-project-id header', async () => {
    const middleware = createProjectContextMiddleware()
    let passed = false
    await middleware(
      createCtx('/flows', 'GET', { 'x-project-id': 'tenant-42' }) as never,
      async () => { passed = true },
    )
    expect(passed).toBe(true)
  })

  test('throws BadRequestException when no x-project-id header and not super admin', async () => {
    const middleware = createProjectContextMiddleware()
    await expect(
      middleware(createCtx('/flows') as never, async () => {}),
    ).rejects.toThrow()
  })
})

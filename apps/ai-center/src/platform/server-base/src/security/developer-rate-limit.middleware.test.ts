import { describe, expect, test } from 'bun:test'
import { HttpException } from '@dangao/bun-server'
import { developerApiAls, type DeveloperApiContext } from '@cube-ai/ai-center/platform/server-shared'
import { createDeveloperRateLimitMiddleware } from './developer-rate-limit.middleware'

// 模块级 buckets 为进程级共享状态：每个用例使用独立 IP / apiKeyId，避免相互污染。
let ipSeq = 0
function nextIp(): string {
  ipSeq += 1
  return `10.99.0.${ipSeq}`
}

function createCtx(path: string, ip: string) {
  return {
    path,
    getClientIp: () => ip,
  }
}

function devApiCtx(apiKeyId: string): DeveloperApiContext {
  return { apiKeyId, flowIdScope: null, accessLevel: 'tenant', tenantId: '1' }
}

async function expectRateLimited(run: () => Promise<unknown>): Promise<HttpException> {
  try {
    await run()
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException)
    return error as HttpException
  }
  throw new Error('expected middleware to throw 429')
}

describe('developer rate limit middleware', () => {
  test('ignores paths outside /flow/run/* and /flow/webhook/*', async () => {
    const middleware = createDeveloperRateLimitMiddleware({ maxPerMin: 1 })
    const ip = nextIp()

    let passes = 0
    for (let i = 0; i < 3; i += 1) {
      await middleware(createCtx('/flows', ip) as never, async () => {
        passes += 1
      })
    }

    expect(passes).toBe(3)
  })

  test('allows /flow/run/* requests within the per-minute budget', async () => {
    const middleware = createDeveloperRateLimitMiddleware({ maxPerMin: 2 })
    const ip = nextIp()

    let passes = 0
    await middleware(createCtx('/flow/run/flow-1', ip) as never, async () => {
      passes += 1
    })
    await middleware(createCtx('/flow/run/flow-1', ip) as never, async () => {
      passes += 1
    })

    expect(passes).toBe(2)
  })

  test('throws 429 with RATE_LIMIT details once budget is exceeded', async () => {
    const middleware = createDeveloperRateLimitMiddleware({ maxPerMin: 1 })
    const ip = nextIp()

    await middleware(createCtx('/flow/run/flow-1', ip) as never, async () => {})

    const error = await expectRateLimited(() =>
      middleware(createCtx('/flow/run/flow-1', ip) as never, async () => {}),
    )

    expect(error.status).toBe(429)
    expect(error.message).toBe('rate limit exceeded')
    const details = error.details as { code?: string; retryAfterSec?: number }
    expect(details.code).toBe('RATE_LIMIT')
    expect(details.retryAfterSec).toBeGreaterThanOrEqual(1)
    expect(details.retryAfterSec).toBeLessThanOrEqual(60)
  })

  test('does not invoke next() for rejected requests', async () => {
    const middleware = createDeveloperRateLimitMiddleware({ maxPerMin: 1 })
    const ip = nextIp()

    await middleware(createCtx('/flow/webhook/hook-1', ip) as never, async () => {})

    let nextCalled = false
    await expectRateLimited(() =>
      middleware(createCtx('/flow/webhook/hook-1', ip) as never, async () => {
        nextCalled = true
      }),
    )

    expect(nextCalled).toBe(false)
  })

  test('keys buckets by client ip when no developer api context', async () => {
    const middleware = createDeveloperRateLimitMiddleware({ maxPerMin: 1 })
    const ipA = nextIp()
    const ipB = nextIp()

    await middleware(createCtx('/flow/run/flow-1', ipA) as never, async () => {})

    let passed = false
    await middleware(createCtx('/flow/run/flow-1', ipB) as never, async () => {
      passed = true
    })

    expect(passed).toBe(true)
  })

  test('keys buckets by apiKeyId when developer api context is set', async () => {
    const middleware = createDeveloperRateLimitMiddleware({ maxPerMin: 1 })
    const sharedIp = nextIp()
    const keyA = `key-a-${Date.now()}`
    const keyB = `key-b-${Date.now()}`

    await developerApiAls.run(devApiCtx(keyA), async () => {
      await middleware(createCtx('/flow/run/flow-1', sharedIp) as never, async () => {})
      await expectRateLimited(() =>
        middleware(createCtx('/flow/run/flow-1', sharedIp) as never, async () => {}),
      )
    })

    // 同一 IP、不同 API Key：独立配额
    let passed = false
    await developerApiAls.run(devApiCtx(keyB), async () => {
      await middleware(createCtx('/flow/run/flow-1', sharedIp) as never, async () => {
        passed = true
      })
    })
    expect(passed).toBe(true)
  })

  test('defaults to 60 requests per minute when no option given', async () => {
    const middleware = createDeveloperRateLimitMiddleware()
    const ip = nextIp()

    let passes = 0
    for (let i = 0; i < 60; i += 1) {
      await middleware(createCtx('/flow/run/flow-1', ip) as never, async () => {
        passes += 1
      })
    }
    expect(passes).toBe(60)

    const error = await expectRateLimited(() =>
      middleware(createCtx('/flow/run/flow-1', ip) as never, async () => {}),
    )
    expect(error.status).toBe(429)
  })
})

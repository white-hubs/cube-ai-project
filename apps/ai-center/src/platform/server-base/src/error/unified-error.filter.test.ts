import { afterEach, describe, expect, test } from 'bun:test'
import { HttpException } from '@dangao/bun-server'
import { UnifiedErrorFilter, type UnifiedErrorBody } from './unified-error.filter'

function createCtx() {
  let status = 0
  const ctx = {
    setStatus(code: number) {
      status = code
    },
    createResponse(body?: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), {
        ...init,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      })
    },
  }
  return { ctx, getStatus: () => status }
}

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
})

describe('UnifiedErrorFilter', () => {
  test('passes through Response instances untouched', () => {
    const filter = new UnifiedErrorFilter()
    const { ctx } = createCtx()
    const original = new Response('teapot', { status: 418 })

    const result = filter.catch(original, ctx as never)

    expect(result).toBe(original)
  })

  test('maps HttpException to unified JSON body with status/code/details', async () => {
    const filter = new UnifiedErrorFilter()
    const { ctx, getStatus } = createCtx()
    const error = new HttpException(404, 'flow not found', { flowId: 'f-1' }, 'NOT_FOUND')

    const result = filter.catch(error, ctx as never)

    expect(result).toBeInstanceOf(Response)
    expect(result?.status).toBe(404)
    expect(getStatus()).toBe(404)
    expect(result?.headers.get('Content-Type')).toBe('application/json; charset=utf-8')
    expect(result?.headers.get('Retry-After')).toBeNull()

    const body = (await result?.json()) as UnifiedErrorBody
    expect(body.status).toBe(404)
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toBe('flow not found')
    expect(body.details).toEqual({ flowId: 'f-1' })
    expect(typeof body.timestamp).toBe('number')
  })

  test('sets Retry-After header from details.retryAfterSec (ceil)', () => {
    const filter = new UnifiedErrorFilter()
    const { ctx } = createCtx()
    const error = new HttpException(429, 'rate limit exceeded', {
      code: 'RATE_LIMIT',
      retryAfterSec: 7.2,
    })

    const result = filter.catch(error, ctx as never)

    expect(result?.status).toBe(429)
    expect(result?.headers.get('Retry-After')).toBe('8')
  })

  test('omits Retry-After when retryAfterSec is missing or non-positive', () => {
    const filter = new UnifiedErrorFilter()

    const { ctx: ctx1 } = createCtx()
    const zero = filter.catch(new HttpException(429, 'limited', { retryAfterSec: 0 }), ctx1 as never)
    expect(zero?.headers.get('Retry-After')).toBeNull()

    const { ctx: ctx2 } = createCtx()
    const invalid = filter.catch(
      new HttpException(429, 'limited', { retryAfterSec: 'soon' }),
      ctx2 as never,
    )
    expect(invalid?.headers.get('Retry-After')).toBeNull()
  })

  test('maps plain Error to 500 with message in details outside production', async () => {
    process.env.NODE_ENV = 'test'
    const filter = new UnifiedErrorFilter()
    const { ctx, getStatus } = createCtx()

    const result = filter.catch(new Error('boom from db'), ctx as never)

    expect(result?.status).toBe(500)
    expect(getStatus()).toBe(500)
    const body = (await result?.json()) as UnifiedErrorBody
    expect(body.status).toBe(500)
    expect(body.message).toBe('Internal Server Error')
    expect(body.details).toBe('boom from db')
  })

  test('hides Error details in production', async () => {
    process.env.NODE_ENV = 'production'
    const filter = new UnifiedErrorFilter()
    const { ctx } = createCtx()

    const result = filter.catch(new Error('secret internals'), ctx as never)

    const body = (await result?.json()) as UnifiedErrorBody
    expect(body.message).toBe('Internal Server Error')
    expect(body.details).toBeUndefined()
  })

  test('maps non-Error throwables to 500 with stringified details', async () => {
    process.env.NODE_ENV = 'test'
    const filter = new UnifiedErrorFilter()
    const { ctx, getStatus } = createCtx()

    const result = filter.catch('raw failure', ctx as never)

    expect(result?.status).toBe(500)
    expect(getStatus()).toBe(500)
    const body = (await result?.json()) as UnifiedErrorBody
    expect(body.message).toBe('Internal Server Error')
    expect(body.details).toBe('raw failure')
  })
})

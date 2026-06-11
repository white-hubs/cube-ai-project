import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { getCube2InternalAccessToken } from './cube2-internal-rpc-auth'

const OUAA_ENV_KEYS = [
  'CUBE2_OUAA_OAUTH2_TOKEN_URL',
  'OUAA_OAUTH2_TOKEN_URL',
  'GHCLOUD_OUAA_OAUTH2_TOKEN_URL',
  'CUBE2_OUAA_CLIENT_ID',
  'OUAA_REGISTRATION_CLIENT_ID',
  'GHCLOUD_OUAA_REGISTRATION_CLIENT_ID',
  'CUBE2_OUAA_CLIENT_SECRET',
  'OUAA_REGISTRATION_CLIENT_SECRET',
  'GHCLOUD_OUAA_REGISTRATION_CLIENT_SECRET',
] as const

const savedEnv = new Map<string, string | undefined>()
const originalFetch = globalThis.fetch

beforeEach(() => {
  for (const key of OUAA_ENV_KEYS) {
    savedEnv.set(key, process.env[key])
    delete process.env[key]
  }
})

afterEach(() => {
  for (const key of OUAA_ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  globalThis.fetch = originalFetch
})

function setFullOuaaEnv() {
  process.env.CUBE2_OUAA_OAUTH2_TOKEN_URL = 'http://ouaa/oauth2/token'
  process.env.CUBE2_OUAA_CLIENT_ID = 'client-1'
  process.env.CUBE2_OUAA_CLIENT_SECRET = 'secret-1'
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): {
  calls: () => number
} {
  let count = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    count += 1
    return impl(String(input), init)
  }) as typeof fetch
  return { calls: () => count }
}

// 注意：模块内有 token 缓存（module-level），失败路径必须先于成功路径执行。
describe('getCube2InternalAccessToken', () => {
  it('returns undefined without contacting network when OUAA env is absent', async () => {
    const stub = stubFetch(async () => {
      throw new Error('must not fetch')
    })
    expect(await getCube2InternalAccessToken()).toBeUndefined()
    expect(stub.calls()).toBe(0)
  })

  it('throws on partial OUAA configuration', async () => {
    process.env.CUBE2_OUAA_OAUTH2_TOKEN_URL = 'http://ouaa/oauth2/token'
    await expect(getCube2InternalAccessToken()).rejects.toThrow(
      'requires token URL, client id and client secret',
    )
  })

  it('propagates non-2xx token endpoint responses as errors', async () => {
    setFullOuaaEnv()
    stubFetch(async () => new Response('invalid_client', { status: 401 }))
    await expect(getCube2InternalAccessToken()).rejects.toThrow(
      'OUAA token request failed: 401 invalid_client',
    )
  })

  it('rejects token responses without access_token', async () => {
    setFullOuaaEnv()
    stubFetch(async () => Response.json({ token_type: 'bearer' }))
    await expect(getCube2InternalAccessToken()).rejects.toThrow('missing access_token')
  })

  it('fetches with client_credentials form body, dedupes concurrent calls and caches the token', async () => {
    setFullOuaaEnv()
    let seenBody = ''
    const seen: { contentType: string | null } = { contentType: null }
    const stub = stubFetch(async (_url, init) => {
      seenBody = String(init?.body)
      seen.contentType = new Headers(init?.headers ?? {}).get('Content-Type')
      return Response.json({ access_token: 'tok-123', expires_in: 3600 })
    })

    const [a, b] = await Promise.all([
      getCube2InternalAccessToken(),
      getCube2InternalAccessToken(),
    ])
    expect(a).toBe('tok-123')
    expect(b).toBe('tok-123')
    expect(stub.calls()).toBe(1)

    const params = new URLSearchParams(seenBody)
    expect(params.get('grant_type')).toBe('client_credentials')
    expect(params.get('client_id')).toBe('client-1')
    expect(params.get('client_secret')).toBe('secret-1')
    expect(seen.contentType).toBe('application/x-www-form-urlencoded')

    // 缓存命中：后续调用不再发起请求
    expect(await getCube2InternalAccessToken()).toBe('tok-123')
    expect(stub.calls()).toBe(1)
  })
})

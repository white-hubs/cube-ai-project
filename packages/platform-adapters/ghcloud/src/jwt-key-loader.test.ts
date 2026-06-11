import { afterEach, describe, expect, it } from 'bun:test'
import { createJwtKeyLoader, createStaticJwtKeyLoader } from './jwt-key-loader'
import { createTestJwtKeyPair, signTestJwt } from './test-helpers/jwt-test-keys'
import { verifyJwtRs256 } from './jwt-crypto'

const originalFetch = globalThis.fetch

function stubFetch(impl: (url: string) => Promise<Response>): { calls: () => number } {
  let count = 0
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    count += 1
    return impl(String(input))
  }) as typeof fetch
  return { calls: () => count }
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('createJwtKeyLoader', () => {
  it('parses a JSON JWKS response into a usable verification key', async () => {
    const { privateKey, jwk } = await createTestJwtKeyPair()
    stubFetch(async () =>
      Response.json({ keys: [{ kty: 'RSA', e: jwk.e, n: jwk.n, alg: 'RS256' }] }),
    )

    const loader = createJwtKeyLoader('http://idp/jwks')
    const key = await loader.getVerificationKey()
    expect(key).not.toBeNull()

    const token = await signTestJwt(privateKey, { id: 11 })
    const payload = await verifyJwtRs256(token, key!)
    expect(payload.id).toBe(11)
  })

  it('parses an XML public key response', async () => {
    const { privateKey, jwk } = await createTestJwtKeyPair()
    stubFetch(async () =>
      new Response(`<RSAKeyValue><n>${jwk.n}</n><e>${jwk.e}</e></RSAKeyValue>`, {
        headers: { 'content-type': 'application/xml' },
      }),
    )

    const loader = createJwtKeyLoader('http://idp/key.xml')
    const key = await loader.getVerificationKey()
    expect(key).not.toBeNull()

    const token = await signTestJwt(privateKey, { id: 12 })
    const payload = await verifyJwtRs256(token, key!)
    expect(payload.id).toBe(12)
  })

  it('caches the key between calls within the TTL', async () => {
    const { jwk } = await createTestJwtKeyPair()
    const stub = stubFetch(async () =>
      Response.json({ keys: [{ kty: 'RSA', e: jwk.e, n: jwk.n }] }),
    )

    const loader = createJwtKeyLoader('http://idp/jwks')
    const first = await loader.getVerificationKey()
    const second = await loader.getVerificationKey()
    expect(first).toBe(second!)
    expect(stub.calls()).toBe(1)
  })

  it('returns null when the key endpoint responds non-2xx', async () => {
    stubFetch(async () => new Response('nope', { status: 503 }))
    const loader = createJwtKeyLoader('http://idp/jwks')
    expect(await loader.getVerificationKey()).toBeNull()
  })

  it('returns null for XML missing modulus/exponent and empty JWKS', async () => {
    stubFetch(async () => new Response('<RSAKeyValue><e>AQAB</e></RSAKeyValue>'))
    expect(await createJwtKeyLoader('http://idp/bad.xml').getVerificationKey()).toBeNull()

    stubFetch(async () => Response.json({ keys: [] }))
    expect(await createJwtKeyLoader('http://idp/empty').getVerificationKey()).toBeNull()
  })
})

describe('createStaticJwtKeyLoader', () => {
  it('always returns the pinned key without fetching', async () => {
    stubFetch(async () => {
      throw new Error('must not fetch')
    })
    const { publicKey } = await createTestJwtKeyPair()
    const loader = createStaticJwtKeyLoader(publicKey)
    expect(await loader.getVerificationKey()).toBe(publicKey)
    await loader.refresh()
    expect(await loader.getVerificationKey()).toBe(publicKey)
  })
})

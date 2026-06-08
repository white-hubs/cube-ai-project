import { importRsaVerificationKey, type VerificationKey } from '../jwt-crypto'

function encodeBase64Url(input: Uint8Array): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export interface TestJwtKeyPair {
  privateKey: CryptoKey
  publicKey: VerificationKey
  jwk: { e?: string; n?: string; kty?: string }
}

export async function createTestJwtKeyPair(): Promise<TestJwtKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ['sign', 'verify'],
  )
  const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as { e?: string; n?: string; kty?: string }
  const publicKey = await importRsaVerificationKey({
    kty: 'RSA',
    e: jwk.e ?? '',
    n: jwk.n ?? '',
    alg: 'RS256',
  })
  if (!publicKey) {
    throw new Error('failed to import test verification key')
  }
  return { privateKey: keyPair.privateKey, publicKey, jwk }
}

export async function signTestJwt(
  privateKey: CryptoKey,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT' }
  const headerSegment = encodeBase64Url(new TextEncoder().encode(JSON.stringify(header)))
  const payloadSegment = encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
  const signingInput = `${headerSegment}.${payloadSegment}`
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput),
  )
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`
}

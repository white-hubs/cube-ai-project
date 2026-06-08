export type VerificationKey = CryptoKey

export interface RsaJsonWebKey {
  kty: 'RSA'
  e: string
  n: string
  alg?: string
  kid?: string
}

function decodeBase64Url(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=')
  return Uint8Array.from(Buffer.from(padded, 'base64'))
}

export async function importRsaVerificationKey(jwk: RsaJsonWebKey): Promise<VerificationKey | null> {
  try {
    return await crypto.subtle.importKey(
      'jwk',
      jwk,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['verify'],
    )
  } catch {
    return null
  }
}

export async function verifyJwtRs256(token: string, key: VerificationKey): Promise<Record<string, unknown>> {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('invalid jwt format')
  }

  const [headerSegment, payloadSegment, signatureSegment] = parts
  const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(headerSegment ?? ''))) as { alg?: string }
  if (header.alg !== 'RS256') {
    throw new Error('unsupported jwt alg')
  }

  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(signatureSegment ?? '') as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  )
  if (!verified) {
    throw new Error('invalid jwt signature')
  }

  return JSON.parse(new TextDecoder().decode(decodeBase64Url(payloadSegment ?? ''))) as Record<string, unknown>
}

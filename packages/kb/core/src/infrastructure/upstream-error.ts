import { HttpException, NotFoundException } from '@dangao/bun-server'

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
])

function extractNetworkError(err: unknown): {
  code: string
  address?: string
  port?: number
} | null {
  if (!(err instanceof Error)) {
    return null
  }
  const nodeErr = err as NodeJS.ErrnoException & { address?: string; port?: number }
  if (nodeErr.code && NETWORK_ERROR_CODES.has(nodeErr.code)) {
    return {
      code: nodeErr.code,
      address: nodeErr.address,
      port: nodeErr.port,
    }
  }
  if (NETWORK_ERROR_CODES.has(err.message)) {
    return { code: err.message }
  }
  const match = err.message.match(
    /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|EAI_AGAIN)\b/,
  )
  return match ? { code: match[1]! } : null
}

export function rethrowKbUpstreamError(step: string, err: unknown): never {
  if (err instanceof HttpException || err instanceof NotFoundException) {
    throw err
  }

  const networkError = extractNetworkError(err)
  if (networkError) {
    const target =
      networkError.address && networkError.port !== undefined
        ? `${networkError.address}:${networkError.port}`
        : networkError.address
    const targetSuffix = target ? ` (${target})` : ''
    throw new HttpException(
      503,
      `KB retrieval step "${step}" failed${targetSuffix}: ${networkError.code}. Check the dependency configured for this step (platform sync → CUBE2_*/NACOS; embedding → LLM catalog provider URL; vector search → QDRANT_URL).`,
      { step, ...networkError },
    )
  }

  throw err
}

export async function runKbUpstreamStep<T>(step: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    rethrowKbUpstreamError(step, err)
  }
}

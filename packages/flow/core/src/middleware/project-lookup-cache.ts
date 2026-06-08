const cache = new Map<string, { v: boolean; exp: number }>()
const TTL_MS = 30_000

export async function cachedProjectExists(key: string, probe: () => Promise<boolean>): Promise<boolean> {
  const k = key.trim()
  if (!k) return probe()
  const now = Date.now()
  const hit = cache.get(k)
  if (hit && hit.exp > now) return hit.v
  const v = await probe()
  cache.set(k, { v, exp: now + TTL_MS })
  return v
}

export function clearProjectLookupCache(): void {
  cache.clear()
}

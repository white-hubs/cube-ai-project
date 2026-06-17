import { HttpException, type Context, type Middleware, type NextFunction } from '@dangao/bun-server'
import { developerApiAls } from '@cube-ai/ai-center/platform/server-shared'

const WINDOW_MS = 60_000

type Bucket = { count: number; windowStart: number }
const buckets = new Map<string, Bucket>()

/**
 * 对 `/run/*`、`/webhook/*` 按 API Key（无 Key 时按客户端 IP）固定窗口限流。
 * @param opts.maxPerMin 每分钟最大请求数，来自 AppConfig.devApiRateLimitPerMin（默认 60）
 */
export function createDeveloperRateLimitMiddleware(opts?: { maxPerMin?: number }): Middleware {
  const max = opts?.maxPerMin ?? 60
  return async (ctx: Context, next: NextFunction) => {
    const path = ctx.path
    if (!path.startsWith('/run/') && !path.startsWith('/webhook/')) {
      return next()
    }
    const store = developerApiAls.getStore()
    const ip = typeof ctx.getClientIp === 'function' ? ctx.getClientIp() : 'unknown'
    const key = store ? `k:${store.apiKeyId}` : `ip:${ip}`
    const now = Date.now()
    let b = buckets.get(key)
    if (!b || now - b.windowStart >= WINDOW_MS) {
      b = { count: 0, windowStart: now }
      buckets.set(key, b)
    }
    b.count += 1
    if (b.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((b.windowStart + WINDOW_MS - now) / 1000))
      throw new HttpException(429, 'rate limit exceeded', {
        code: 'RATE_LIMIT',
        retryAfterSec,
      })
    }
    return next()
  }
}

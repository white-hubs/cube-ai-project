/** BullMQ/ioredis connection options shared by KB background workers. */
export interface KbRedisEnvironment {
  AGENTIC_ENGINE_REDIS_URL?: string;
  BUN_REDIS_URL?: string;
  REDIS_URL?: string;
}

export function resolveKbRedisUrl(env?: KbRedisEnvironment): string {
  const source = env ?? (process.env as KbRedisEnvironment);
  return source.AGENTIC_ENGINE_REDIS_URL?.trim() || source.REDIS_URL?.trim() || source.BUN_REDIS_URL?.trim() || "redis://127.0.0.1:6379/0";
}

export function buildKbBullMqConnectionFromEnv(env?: KbRedisEnvironment): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db: number;
  maxRetriesPerRequest: null;
  tls?: Record<string, never>;
} {
  const raw = resolveKbRedisUrl(env);
  const url = new URL(raw);
  const database = Number(url.pathname.replace(/^\//u, "") || "0");
  return {
    db: Number.isInteger(database) && database >= 0 ? database : 0,
    host: url.hostname,
    maxRetriesPerRequest: null,
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    port: Number(url.port || 6379),
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
  };
}

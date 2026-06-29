import { Injectable } from "@dangao/bun-server";

import { NacosSecretsLoader } from "./nacos-secrets.loader";

/**
 * SecretResolver — replaces `${secret:KEY}` placeholders in config strings
 * with their actual values from SecretsRegistry.
 *
 * ref: P1-12 design doc §3.3 / secrets-management.md §3.1 (KMS ref format)
 *
 * Usage:
 *   const dsn = resolver.resolve('mysql://root:${secret:DB_PASSWORD}@host/db');
 *   // → 'mysql://root:actualPassword@host/db'
 *
 * Rules:
 * - KEY must match [A-Z0-9_]+ (uppercase alphanumeric + underscore)
 * - Missing KEY → throws (AgenticEngineError SECRET_MISSING from loader.get())
 * - Nested placeholders are NOT supported (single-pass replace)
 * - SM-R4: result string must never be logged as-is; caller responsibility
 */
@Injectable()
export class SecretResolver {
  private static readonly PLACEHOLDER_RE = /\$\{secret:([A-Z0-9_]+)\}/g;

  constructor(private readonly loader: NacosSecretsLoader) {}

  /**
   * Resolves all `${secret:KEY}` placeholders in `s`.
   * Throws if any placeholder key is missing from the loaded secrets.
   */
  resolve(s: string): string {
    return s.replace(SecretResolver.PLACEHOLDER_RE, (_match, key: string) => {
      return this.loader.get(key);
    });
  }

  /**
   * Resolves placeholders in all string leaves of a config object。
   * 嵌套深度上限 16；超限抛错防止循环引用。
   */
  resolveObject<T extends Record<string, unknown>>(obj: T, depth = 0, maxDepth = 16): T {
    if (depth > maxDepth) {
      throw new Error(`SecretResolver.resolveObject: max depth ${maxDepth} exceeded`);
    }
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        result[k] = this.resolve(v);
      } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
        result[k] = this.resolveObject(v as Record<string, unknown>, depth + 1, maxDepth);
      } else {
        result[k] = v;
      }
    }
    return result as T;
  }
}

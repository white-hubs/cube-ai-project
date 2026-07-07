/**
 * LoggerFactory：pino factory + 10 字段 JSON schema + redaction。
 *
 * 设计参考：docs/technical-design/phase-1/P1-10-observability.md §3.4
 * M1 权威：docs/detailed-design/11-observability/logging.md §3.1 + §4.2
 *
 * 命名约定：
 * - Log JSON 键名：camelCase（logging.md §3.1 / 规范 §5.1）
 * - 业务枚举值：UPPERCASE（规范 §5.2）
 * - Nacos 热更 logLevel：UPPERCASE → .toLowerCase() 喂给 pino（logging.md §2）
 */

import { Injectable } from "@dangao/bun-server";
import pino from "pino";

import { correlationStorage } from "./log-context";

/**
 * 10 必填字段（camelCase）— logging.md §3.1。
 * pino 自动生成：time / level / pid / hostname。
 * 门面层注入：serviceName / serviceVersion / deploymentEnvironment。
 * OTel instrumentation-pino 自动注入：traceId / spanId。
 */
export interface LogFields {
  level: number; // pino 数值 10..60
  time: number; // epoch ms number（规范 §4.2，禁止 ISO8601）
  pid: number;
  hostname: string;
  msg: string;
  serviceName: string; // 'cube-agentic-engine'
  serviceVersion: string;
  deploymentEnvironment: string; // UPPERCASE: PROD/STAGING/TEST/DEV
  traceId: string | null;
  spanId: string | null;
}

/**
 * redact paths — logging.md §4.2。
 * 编译期固定，不允许通过 Nacos 热更（避免运行时打开导致泄漏）。
 */
export const REDACTION_PATHS: readonly string[] = [
  // HTTP Headers（协议 canonical 大小写，pino redact 大小写不敏感）
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-forwarded-for"]',
  'res.headers["set-cookie"]',

  // OAuth2 凭据
  "*.accessToken",
  "*.refreshToken",
  "*.idToken",
  "*.password",
  "*.clientSecret",
  "*.oboPrivateKey",

  // token sub-keys
  "user.token",
  "principal.token",
  "obo.token",

  // 出站 MCP 身份透传窄 carrier（原始用户 Authorization，禁落日志/审计）
  "*.callIdentity.authorization",
  "callIdentity.authorization",

  // 业务内容（PII / 隐私）
  "*.message.content",
  "*.messages[*].content",
  "*.tool.args",
  "*.tool.result",
] as const;

/** DI token — design doc §3.4 */
export const DI_LOGGER_FACTORY = Symbol.for("agentic.observability.loggerFactory");

@Injectable()
export class LoggerFactory {
  private readonly basePino: pino.Logger;

  constructor() {
    this.basePino = pino({
      level: (process.env.AGENTIC_ENGINE_LOG_LEVEL ?? "info").toLowerCase(),
      timestamp: pino.stdTimeFunctions.epochTime,
      messageKey: "msg",
      base: {
        serviceName: "cube-agentic-engine",
        serviceVersion: process.env.AGENTIC_ENGINE_VERSION ?? "0.0.0",
        deploymentEnvironment: (process.env.AGENTIC_ENGINE_ENV ?? "DEV").toUpperCase(),
      },
      mixin: () => {
        const store = correlationStorage.getStore();
        if (!store) return {};
        // 过滤 null 值，避免 JSON 输出含冗余 null 字段
        return Object.fromEntries(Object.entries(store).filter(([, v]) => v !== null));
      },
      redact: {
        paths: REDACTION_PATHS as string[],
        censor: "[REDACTED]",
        remove: false,
      },
    });
  }

  /**
   * 按命名空间返回 child logger。
   * ns 字段使用 lowercase.dotted（OTel InstrumentationScope.name 对齐，协议例外）。
   * 示例：'agentic.engine.server.http'
   */
  getLogger(namespace: string): pino.Logger {
    return this.basePino.child({ ns: namespace });
  }

  /** 根 logger（无 ns）— 仅内部 / 测试用 */
  getRootLogger(): pino.Logger {
    return this.basePino;
  }
}

/**
 * Bootstrap-time pino logger that mirrors LoggerFactory output (camelCase
 * fields, level label formatter, ns base) but does NOT depend on DI.
 *
 * Usage: scripts that must run before the DI container is built — e.g.
 * `otel-setup.ts` (loaded with side-effect at the top of `main.ts`).
 */
export function createBootstrapLogger(name: string, ns: string): pino.Logger {
  return pino({
    name,
    level: process.env.AGENTIC_ENGINE_LOG_LEVEL?.toLowerCase() ?? "info",
    base: { ns },
    formatters: {
      level: (label) => ({ level: label }),
    },
  });
}

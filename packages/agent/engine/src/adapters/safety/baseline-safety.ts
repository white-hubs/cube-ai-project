// 实装 @tachu/core SafetyModule Port — 基线安全检查（输入长度 + 黑名单关键字）
// ref: docs/detailed-design/03-core-adapters/safety.md §3.3 / §3.4
// P1-12 扩展 policy-registry.ts（本文件不含）
// ADR-0017: metadata.safetyClass 决定 contract policy 链（review）
import type { SafetyInput, SafetyResult } from '@cube-ai/contracts';
import {
  HostError,
  type ExecutionContext,
  type InputEnvelope,
  type PhaseName,
  type SafetyModule,
  type SafetyPolicy,
  type SafetyResult as TachuSafetyResult,
  type SafetyViolation,
} from '@tachu/core';
import { LengthPolicy } from './policies/length-policy';
import { PiiPolicy } from './policies/pii-policy';
import { ShellBlacklistPolicy } from './policies/shell-blacklist-policy';
import type { DlpProvider } from './dlp-provider.port';
import type { ShellBlacklistConfigService } from './shell-blacklist.config';
import {
  NO_OP_SAFETY_AUDIT_SINK,
  type SafetyAuditEvent,
  type SafetyAuditEventContext,
  type SafetyAuditSink,
} from './safety-audit.port';

/** ADR-0017：与 design 文档对齐的 safety 分级闭集 */
export type SafetyClassId =
  | 'L0_PUBLIC'
  | 'L1_USER_DATA'
  | 'L2_USER_WRITE'
  | 'L3_PRIVILEGED'
  | 'L4_DESTRUCTIVE';

/**
 * 工具/描述符上用于 review 的最小形状（含 `metadata.safetyClass`）。
 * 与 agentic-contracts 完整 Zod 并存；缺失字段时回退到 L1。
 */
export interface DescriptorSafetyMetadata {
  metadata?: { safetyClass?: string };
}

export interface SafetyReviewResult {
  /** 经 PII mask 后的文本；无改写则为 undefined */
  maskedText?: string;
}

/**
 * 各 safetyClass 对应的 contract 策略链（注册名 → policies/*.ts 的 `name`）。
 * L0 仅长度；L1+ 增加 PII；L2+ 增加 shell 黑名单（工具侧最危险面）。
 */
export const SAFETY_CLASS_CHAINS: Record<SafetyClassId, readonly string[]> = {
  L0_PUBLIC: ['length-check'],
  L1_USER_DATA: ['length-check', 'pii-scan'],
  L2_USER_WRITE: ['length-check', 'pii-scan', 'shell-blacklist'],
  L3_PRIVILEGED: ['length-check', 'pii-scan', 'shell-blacklist'],
  L4_DESTRUCTIVE: ['length-check', 'pii-scan', 'shell-blacklist'],
};

/** Baseline safety configuration (safety.md §3.4 + §5) */
export interface BaselineSafetyConfig {
  /** Max allowed input character count; default 10000 (safety.md §1.4) */
  maxInputLength?: number;
  /** Keywords to block; case-insensitive by default (safety.md §3.4) */
  blacklistKeywords?: string[];
  /** Whether blacklist matching is case-sensitive; default false */
  blacklistCaseSensitive?: boolean;
}

/**
 * Adapter wiring extension points beyond the legacy {@link BaselineSafetyConfig}.
 *
 * - `audit`: optional sink for `deny` / `mask` events. Default: no-op (used
 *   by unit tests / standalone use). Engine wires `AuditLogSafetyAuditAdapter`.
 * - `dlp`: optional DLP provider override (e.g. enterprise Macie / Google
 *   DLP). Default: in-package `RegexPiiProvider`.
 * - `shellBlacklist`: optional Nacos-driven first-token blacklist service.
 *   When omitted, only the built-in regex patterns fire.
 */
export interface BaselineSafetyAdapterOptions {
  audit?: SafetyAuditSink;
  dlp?: DlpProvider;
  shellBlacklist?: ShellBlacklistConfigService;
}

/** Violation policy IDs emitted by baseline checks */
export const BASELINE_POLICY_IDS = {
  INPUT_TOO_LONG: 'baseline/input_too_long',
  BLACKLIST_HIT: 'baseline/blacklist_hit',
} as const;

function normalizeSafetyClass(raw: string | undefined): SafetyClassId {
  const id = (raw ?? 'L1_USER_DATA').trim();
  if (
    id === 'L0_PUBLIC' ||
    id === 'L1_USER_DATA' ||
    id === 'L2_USER_WRITE' ||
    id === 'L3_PRIVILEGED' ||
    id === 'L4_DESTRUCTIVE'
  ) {
    return id;
  }
  return 'L1_USER_DATA';
}

/**
 * Baseline SafetyModule.
 *
 * Phase 1 增强内容（相对 Phase 0a 的 pass-through）：
 * - checkBaseline(): 输入长度检查 + 黑名单关键字检查
 * - checkBusiness(): 遍历注册的 SafetyPolicy（已有逻辑保留）
 *
 * Phase 3：
 * - review()：按 descriptor.metadata.safetyClass 跑 agentic-contracts 策略链（PII / shell / length）
 *
 * Phase 4 (T12):
 * - Optional pluggable {@link DlpProvider} (default: regex-based) — enables
 *   enterprise Macie / Google DLP wire-in via {@link BaselineSafetyAdapterOptions.dlp}.
 * - Optional Nacos-driven shell-blacklist hot reload via
 *   {@link BaselineSafetyAdapterOptions.shellBlacklist}.
 * - `deny` / `mask` decisions in `review()` fan out to the configured
 *   {@link SafetyAuditSink} (default: no-op). The engine wires
 *   `AuditLogSafetyAuditAdapter` so violations land in the audit outbox.
 *
 * 默认行为（safety.md §1.4 + §6）：
 * - impl: rule_based（轻量规则，无外部 HTTP 调用）
 * - on_failure: pass（best-effort；生产可 Nacos 热更改 fail-closed）
 *
 * ref: docs/detailed-design/03-core-adapters/safety.md §3 / §6
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md
 */
export class BaselineSafetyAdapter implements SafetyModule {
  private readonly policies = new Set<SafetyPolicy>();
  private readonly maxInputLength: number;
  private readonly blacklistKeywords: string[];
  private readonly caseSensitive: boolean;

  private readonly lengthPolicy: LengthPolicy;
  private readonly piiPolicy: PiiPolicy;
  private readonly shellPolicy: ShellBlacklistPolicy;
  private readonly audit: SafetyAuditSink;

  constructor(
    config: BaselineSafetyConfig = {},
    options: BaselineSafetyAdapterOptions = {},
  ) {
    this.maxInputLength = config.maxInputLength ?? 10_000;
    this.blacklistKeywords = config.blacklistKeywords ?? [];
    this.caseSensitive = config.blacklistCaseSensitive ?? false;
    this.audit = options.audit ?? NO_OP_SAFETY_AUDIT_SINK;
    this.lengthPolicy = new LengthPolicy();
    this.piiPolicy = new PiiPolicy(options.dlp);
    this.shellPolicy = new ShellBlacklistPolicy(options.shellBlacklist);
  }

  /**
   * 基于 ADR-0017 safetyClass 的策略审查（引擎 Tool 调用前使用）。
   *
   * - `deny` → throws `INVALID_ARGUMENT_SAFETY_VIOLATION` AND fans out an
   *   `onViolation({ kind: 'deny' })` event to the audit sink.
   * - `mask` → updates working text AND fans out an `onViolation({ kind: 'mask' })`
   *   event; subsequent policies see the masked text.
   *
   * Audit calls are fire-and-forget; sink failures must never block the
   * safety decision flow.
   *
   * History: P3-14 once required a `(adapter as any).review(...)` cast at
   * call sites because `@tachu/core@1.0.0-alpha.1` lacked a typed `review`
   * on `SafetyModule`. The codebase now consumes `@tachu/core@1.0.0-alpha.2`,
   * and `BaselineSafetyAdapter.review` is a typed engine extension on top
   * of the Port — callers reference it directly without casts.
   */
  async review(
    input: InputEnvelope,
    descriptor: DescriptorSafetyMetadata,
    context: ExecutionContext,
  ): Promise<SafetyReviewResult> {
    const safetyClass = normalizeSafetyClass(descriptor.metadata?.safetyClass);
    const chain = SAFETY_CLASS_CHAINS[safetyClass];
    const auditCtx = toAuditContext(context);

    let text = extractText(input);
    const originalText = text;
    let outMasked: string | undefined;

    for (const policyId of chain) {
      const safetyInput: SafetyInput = {
        text,
        metadata: { safetyClass },
      };
      const r = this.evaluateContractPolicy(policyId, safetyInput);
      if (r.kind === 'deny') {
        this.fireAuditEvent({
          kind: 'deny',
          policy: policyId,
          reason: r.reason,
          safetyClass,
          context: auditCtx,
        });
        throw new HostError('INVALID_ARGUMENT_SAFETY_VIOLATION', r.reason, {
          context: { policyId, safetyClass, reason: r.reason },
          retryable: false,
        });
      }
      if (r.kind === 'mask') {
        text = r.masked;
        outMasked = text;
        this.fireAuditEvent({
          kind: 'mask',
          policy: policyId,
          reason: 'pii detected; masked',
          safetyClass,
          context: auditCtx,
          detail: { maskedLength: r.masked.length },
        });
      }
    }

    if (outMasked !== undefined && outMasked !== originalText) {
      return { maskedText: outMasked };
    }
    return {};
  }

  private evaluateContractPolicy(policyId: string, input: SafetyInput): SafetyResult {
    switch (policyId) {
      case 'length-check':
        return this.lengthPolicy.evaluate(input);
      case 'pii-scan':
        return this.piiPolicy.evaluate(input);
      case 'shell-blacklist':
        return this.shellPolicy.evaluate(input);
      default:
        return { kind: 'allow' };
    }
  }

  /**
   * Fire-and-forget audit event. Wrapped in try/catch + tail `.catch` so
   * sink errors never escape into the safety flow.
   */
  private fireAuditEvent(event: SafetyAuditEvent): void {
    try {
      const result = this.audit.onViolation(event);
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          /* sink failures are best-effort; never propagate */
        });
      }
    } catch {
      /* synchronous sink throw — best-effort swallow */
    }
  }

  async checkBaseline(
    input: InputEnvelope,
    _context: ExecutionContext,
  ): Promise<TachuSafetyResult> {
    const violations: SafetyViolation[] = [];
    const text = extractText(input);

    // Check 1: Input length (safety.md §3.4)
    if (text.length > this.maxInputLength) {
      violations.push({
        policyId: BASELINE_POLICY_IDS.INPUT_TOO_LONG,
        severity: 'error',
        message: `Input length ${text.length} exceeds max ${this.maxInputLength}`,
        details: {
          length: text.length,
          maxInputLength: this.maxInputLength,
        },
      });
    }

    // Check 2: Blacklist keywords (safety.md §3.4)
    if (violations.length === 0 && this.blacklistKeywords.length > 0) {
      const haystack = this.caseSensitive ? text : text.toLowerCase();
      for (const kw of this.blacklistKeywords) {
        const needle = this.caseSensitive ? kw : kw.toLowerCase();
        if (haystack.includes(needle)) {
          violations.push({
            policyId: BASELINE_POLICY_IDS.BLACKLIST_HIT,
            severity: 'error',
            message: `Input matches blacklisted keyword: ${kw}`,
            details: { keyword: kw },
          });
          break; // one violation is enough to block
        }
      }
    }

    return {
      passed: violations.every((v) => v.severity !== 'error'),
      violations,
    };
  }

  async checkBusiness(
    input: InputEnvelope,
    context: ExecutionContext,
    phase: PhaseName = 'safety',
  ): Promise<TachuSafetyResult> {
    const violations: SafetyViolation[] = [];
    for (const policy of this.policies) {
      const inScope =
        policy.scope.includes('*' as never) ||
        (policy.scope as PhaseName[]).includes(phase);
      if (!inScope) continue;
      const r = await policy.check(input, context);
      for (const v of r.violations) violations.push(v);
    }
    return {
      passed: violations.every((v) => v.severity !== 'error'),
      violations,
    };
  }

  registerPolicy(policy: SafetyPolicy): () => void {
    this.policies.add(policy);
    return () => this.policies.delete(policy);
  }
}

/** Map `ExecutionContext` correlation fields onto a {@link SafetyAuditEventContext}. */
function toAuditContext(ctx: ExecutionContext): SafetyAuditEventContext {
  const out: SafetyAuditEventContext = {};
  if (typeof ctx.correlation.requestId === 'string' && ctx.correlation.requestId.length > 0) {
    out.requestId = ctx.correlation.requestId;
  }
  if (typeof ctx.correlation.sessionId === 'string' && ctx.correlation.sessionId.length > 0) {
    out.sessionId = ctx.correlation.sessionId;
  }
  if (typeof ctx.correlation.traceId === 'string' && ctx.correlation.traceId.length > 0) {
    out.traceId = ctx.correlation.traceId;
  }
  return out;
}

/**
 * Extract string representation from InputEnvelope for text checks.
 * ref: safety.md §3.3 (accumulated_text / checkInput text param)
 */
function extractText(input: InputEnvelope): string {
  if (typeof input.content === 'string') return input.content;
  if (input.content !== null && input.content !== undefined) {
    return JSON.stringify(input.content);
  }
  return '';
}

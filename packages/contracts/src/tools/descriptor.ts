/**
 * ToolDescriptor v1 完整 Zod schema。
 *
 * 权威来源：docs/detailed-design/07-tools/descriptor-schema.md
 *   §2  顶层结构
 *   §3  meta 字段语义表
 *   §5  execute 字段（ref 字符串格式）
 *   §8.5 校验流程（8 步）
 *   §9  JSON Schema 完整形式
 *   §10 关键不变式
 *
 * 枚举值全部 UPPERCASE（对齐 descriptor-schema.md v2.0 Phase 5 规范对齐重写节）。
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums（所有业务枚举 UPPERCASE — descriptor-schema.md 顶部 v2.0 重写说明）
// ---------------------------------------------------------------------------

/** execution 模式 — descriptor-schema.md §3.1 */
export const ExecutionMode = z.enum(['LOCAL', 'REMOTE', 'LONG_RUNNING']);
export type ExecutionMode = z.infer<typeof ExecutionMode>;

/** consent 模式（4 值闭集）— descriptor-schema.md §3.2 */
export const ConsentMode = z.enum(['NEVER', 'ON_FIRST_USE', 'EACH_CALL', 'ADMIN_ONLY']);
export type ConsentMode = z.infer<typeof ConsentMode>;

/** 主体类型 — descriptor-schema.md §3.3 */
export const PrincipalKind = z.enum(['USER', 'SERVICE', 'ANY']);
export type PrincipalKind = z.infer<typeof PrincipalKind>;

/** Tool 分类（可选）— descriptor-schema.md §2 */
export const ToolCategory = z.enum(['PLATFORM', 'MEMORY', 'CUSTOM', 'MCP']);
export type ToolCategory = z.infer<typeof ToolCategory>;

/** costEstimate.category — descriptor-schema.md §6.2 */
export const CostEstimateCategory = z.enum([
  'IO_LIGHT',
  'IO_MEDIUM',
  'IO_HEAVY',
  'LLM_CALL',
  'LONG_RUNNING',
]);
export type CostEstimateCategory = z.infer<typeof CostEstimateCategory>;

/** HandlerKind（来自 P1-08 prompt §6.1，不在 descriptor-schema.md 中）*/
export const HandlerKind = z.enum([
  'http',
  'shell',
  'sql',
  'vector',
  'memory',
  'openapi',
  'mcp',
  'llm',
  'flow',
  'flowList',
  'knowledge',
  'clock',
  'qwenImage',
  'descriptorOps',
]);
export type HandlerKind = z.infer<typeof HandlerKind>;

// ---------------------------------------------------------------------------
// execute ref 格式校验 — descriptor-schema.md §5.2
// ---------------------------------------------------------------------------

export const EXECUTE_REF_PATTERN =
  /^(builtin:[a-z0-9_]+(\.[a-z0-9_]+)+|ext:\d+:[a-z0-9_]+(\.[a-z0-9_]+)+|mcp:[a-z0-9][a-z0-9\-]{0,31}:[a-zA-Z0-9_.\-]+)$/;

/** 校验 execute ref 字符串 — descriptor-schema.md §5.2 */
export function validateExecuteRef(ref: string): boolean {
  return ref.length <= 128 && EXECUTE_REF_PATTERN.test(ref);
}

// ---------------------------------------------------------------------------
// sideEffects pattern — descriptor-schema.md §3.4
// ---------------------------------------------------------------------------

const SIDE_EFFECT_PATTERN = /^[a-z]+:[a-z0-9_.\-]+$/;

// ---------------------------------------------------------------------------
// Sub-schemas
// ---------------------------------------------------------------------------

/** meta 对象 — descriptor-schema.md §3（6 个必需字段，additionalProperties: false）*/
export const ToolDescriptorMeta = z
  .object({
    execution:          ExecutionMode,
    consent:            ConsentMode,
    requiresPrincipal:  PrincipalKind,
    timeoutMs:          z.number().int().min(100).max(600_000),
    idempotent:         z.boolean(),
    sideEffects:        z
      .array(z.string().regex(SIDE_EFFECT_PATTERN, 'sideEffect must match <category>:<resource>'))
      .default([]),
  })
  .strict();

export type ToolDescriptorMeta = z.infer<typeof ToolDescriptorMeta>;

/** requires 对象 — descriptor-schema.md §2 */
export const ToolDescriptorRequires = z.object({
  principal:   PrincipalKind,
  oauthScope:  z.array(z.string()),
  obo:         z
    .union([
      z.null(),
      z.object({
        audience: z.string().min(1),
        scope:    z.array(z.string()).optional(),
      }),
    ])
    .optional()
    .nullable(),
});

export type ToolDescriptorRequires = z.infer<typeof ToolDescriptorRequires>;

/** inputSchema / outputSchema（JSON Schema draft 2020-12 骨架校验）— descriptor-schema.md §4 */
const JsonSchemaObject = z
  .object({
    type:       z.literal('object'),
    properties: z.record(z.string(), z.unknown()),
  })
  .passthrough();

/** rateLimit 可选字段 — descriptor-schema.md §6.1 */
const RateLimit = z.object({
  perUserPerMin:    z.number().optional(),
  perTenantPerMin:  z.number().optional(),
  globalPerMin:     z.number().optional(),
});

/** retryPolicy 可选字段 — descriptor-schema.md §6.3 */
const RetryPolicy = z.object({
  maxAttempts:  z.number().int().optional(),
  backoffMs:    z.number().optional(),
  retryOn:      z.array(z.string()).optional(),
});

// ---------------------------------------------------------------------------
// ToolDescriptor（顶层 11 必需字段 + 可选字段）
// descriptor-schema.md §2, §9
// ---------------------------------------------------------------------------

export const ToolDescriptor = z.object({
  // --- 必需字段（descriptor-schema.md §8.1）---
  schemaVersion:  z.literal(1),
  kind:           z.literal('TOOL'),
  name:           z.string().min(1).max(128),
  displayName:    z.string().min(1).max(128),
  isPreset:       z.boolean(),
  meta:           ToolDescriptorMeta,
  inputSchema:    JsonSchemaObject,
  outputSchema:   JsonSchemaObject,
  requires:       ToolDescriptorRequires,
  execute:        z
    .string()
    .max(128)
    .regex(EXECUTE_REF_PATTERN, 'INVALID_ARGUMENT_DESCRIPTOR_EXECUTE_REF'),

  // --- 推荐字段 ---
  description:    z.string().max(2048).optional(),

  // --- 可选字段（M1 预留）---
  tags:               z.array(z.string()).optional(),
  category:           ToolCategory.optional(),

  /**
   * 工具**执行**消费的资源声明（ADR-0026 D4c）。
   * 语义为「该工具运行时需要哪些 kind 的正文资源 / 是否必需」，**不等于**「推理 LLM
   * 选择调用该工具时需要看到什么」。仅作 `resourceDemandRouter` 的输入参考
   * （`candidateTools`），core 绝不据此自动裁剪推理 prompt。
   */
  consumes:           z
    .object({
      kinds:    z.array(z.string()).optional(),
      required: z.boolean().optional(),
    })
    .optional(),
  rateLimit:          RateLimit.optional(),
  costEstimate:       z.object({ category: CostEstimateCategory }).optional(),
  retryPolicy:        RetryPolicy.optional(),
  deprecated:         z.boolean().optional(),
  deprecatedMessage:  z.string().nullable().optional(),

  /**
   * handler 字段（P1-08 骨架扩展；与 execute ref 并存）。
   * execute 是 handler dispatcher 路由 ref；
   * handler.kind 用于骨架期 ToolService 内部路由。
   */
  handler: z
    .object({
      kind:   HandlerKind,
      config: z.object({}).passthrough(),
    })
    .optional(),

  /**
   * TODO(P1-08): wire P1-05 ConsentArgsExpr when available
   * ref design doc §3.1, §13 A-1
   */
  grantArgs: z.object({}).passthrough().optional(),

  /**
   * 骨架期版本字段（DescriptorRegistry key = name@version 需要）。
   * M1 文档中版本存于 descriptor_versions.version_no；这里作骨架占位。
   * TODO(P1-08): Phase 2 从 descriptor_versions DB 行读取，不在 JSON 中存 — ref design doc §4.1, §13 A-1
   */
  version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
});

export type ToolDescriptor = z.infer<typeof ToolDescriptor>;

// ---------------------------------------------------------------------------
// LONG_RUNNING output schema 模板 — descriptor-schema.md §7.3.1
// ---------------------------------------------------------------------------

export const LONG_RUNNING_OUTPUT_SCHEMA = {
  type: 'object' as const,
  required: ['scheduled', 'jobId'],
  properties: {
    scheduled:           { const: true },
    jobId:               { type: 'string', pattern: '^\\d{1,20}$', description: 'SFID 纯数字' },
    statusUrl:           { type: 'string', format: 'uri' },
    estimatedDurationMs: { type: 'integer' },
  },
};

// ---------------------------------------------------------------------------
// 8 步校验辅助函数（descriptor-schema.md §8.5）
// ---------------------------------------------------------------------------

export interface DescriptorValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * 在 Zod parse 之外执行 descriptor-schema.md §8.5 的 7 条跨字段一致性校验。
 * Zod schema 本身已覆盖步骤 1-4；本函数补覆盖步骤 5-8。
 */
export function validateDescriptorConsistency(
  d: ToolDescriptor,
): DescriptorValidationResult {
  const errors: string[] = [];

  // 步骤 5：meta.requiresPrincipal === requires.principal
  if (d.meta.requiresPrincipal !== d.requires.principal) {
    errors.push(
      `INVALID_ARGUMENT_DESCRIPTOR_CONSISTENCY: meta.requiresPrincipal(${d.meta.requiresPrincipal}) !== requires.principal(${d.requires.principal})`,
    );
  }

  // 步骤 6：oauthScope 排序规范
  const scopes = d.requires.oauthScope;
  const sorted = [...scopes].sort();
  if (JSON.stringify(scopes) !== JSON.stringify(sorted)) {
    errors.push(
      `INVALID_ARGUMENT_DESCRIPTOR_CONSISTENCY: oauthScope must be sorted ascending`,
    );
  }

  // 步骤 8：isPreset=true ⇔ execute 以 builtin: 开头（tenant=0 体现在运行时）
  // 注：tenant 字段在 ToolDescriptor JSON 中无，由 DB 列存储；此处只检查 execute 前缀
  if (d.isPreset && !d.execute.startsWith('builtin:')) {
    errors.push(
      `FAILED_PRECONDITION_DESCRIPTOR_TENANT_MISMATCH: isPreset=true but execute ref is not builtin:*`,
    );
  }

  // LONG_RUNNING output schema 必须含 scheduled + jobId — §10 不变式 3
  if (d.meta.execution === 'LONG_RUNNING') {
    const outProps = d.outputSchema.properties as Record<string, unknown>;
    if (!('scheduled' in outProps) || !('jobId' in outProps)) {
      errors.push(
        `INVALID_ARGUMENT_DESCRIPTOR_LONG_RUNNING_OUTPUT: LONG_RUNNING tool outputSchema must have 'scheduled' and 'jobId' fields`,
      );
    }
  }

  // deprecated=true ⇒ deprecatedMessage 非 null — §10 不变式 4
  if (d.deprecated === true && !d.deprecatedMessage) {
    errors.push(
      `INVALID_ARGUMENT_DESCRIPTOR_CONSISTENCY: deprecated=true but deprecatedMessage is null/missing`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * ToolDescriptor Zod schema 单测。
 *
 * 对齐：
 *   docs/detailed-design/07-tools/descriptor-schema.md §12 测试矩阵
 *   docs/technical-design/prompts/phase-1/P1-08-tools.md §7
 */
import { describe, test, expect } from 'bun:test';
import {
  ToolDescriptor,
  validateDescriptorConsistency,
  EXECUTE_REF_PATTERN,
} from './descriptor';

// ---------------------------------------------------------------------------
// 合法 descriptor 基础模板
// ---------------------------------------------------------------------------

const BASE_DESCRIPTOR = {
  schemaVersion:  1,
  kind:           'TOOL',
  name:           'platform.file.read',
  displayName:    '读取文件',
  description:    '读取平台文件',
  isPreset:       true,
  meta: {
    execution:          'LOCAL',
    consent:            'ON_FIRST_USE',
    requiresPrincipal:  'USER',
    timeoutMs:          15000,
    idempotent:         true,
    sideEffects:        ['read:platform.file'],
  },
  inputSchema: {
    type:       'object',
    properties: {
      fileId: { type: 'string', description: '文件 ID' },
    },
  },
  outputSchema: {
    type:       'object',
    properties: {
      content: { type: 'string', description: '文件内容' },
    },
  },
  requires: {
    principal:  'USER',
    oauthScope: ['file.read'],
    obo:        { audience: 'app.file' },
  },
  execute:  'builtin:platform.file.read',
  version:  '1.0.0',
} as const;

// ---------------------------------------------------------------------------
// §12 测试矩阵
// ---------------------------------------------------------------------------

describe('ToolDescriptor Zod schema', () => {
  test('#1 合法 builtin descriptor 解析成功', () => {
    const result = ToolDescriptor.safeParse(BASE_DESCRIPTOR);
    expect(result.success).toBe(true);
  });

  test('#2 schemaVersion=2 → 拒绝（当前只支持 v1）', () => {
    const result = ToolDescriptor.safeParse({ ...BASE_DESCRIPTOR, schemaVersion: 2 });
    expect(result.success).toBe(false);
  });

  test('#3 缺 meta.consent → 拒绝', () => {
    const { consent: _omit, ...metaWithout } = BASE_DESCRIPTOR.meta;
    const result = ToolDescriptor.safeParse({ ...BASE_DESCRIPTOR, meta: metaWithout });
    expect(result.success).toBe(false);
  });

  test('#4 meta.consent 不在闭集内 → 拒绝', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      meta: { ...BASE_DESCRIPTOR.meta, consent: 'PROMPT' },
    });
    expect(result.success).toBe(false);
  });

  test('#5 inputSchema.type="array" → 拒绝（顶层必须 object）', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      inputSchema: { type: 'array', properties: {} },
    });
    expect(result.success).toBe(false);
  });

  test('#6 execute 含大写 → 拒绝（EXECUTE_REF_PATTERN）', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      execute: 'builtin:Platform.File.Read',
    });
    expect(result.success).toBe(false);
  });

  test('#7 execute 非法前缀 "weird:foo" → 拒绝', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      execute: 'weird:foo',
    });
    expect(result.success).toBe(false);
  });

  test('#11 sideEffects 含大写 → 拒绝（小写 pattern）', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      meta: { ...BASE_DESCRIPTOR.meta, sideEffects: ['Read:Foo'] },
    });
    expect(result.success).toBe(false);
  });

  test('#15 合法 ext:101:hr.salary.read → 接受', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      isPreset: false,
      execute:  'ext:101:hr.salary.read',
      requires: { ...BASE_DESCRIPTOR.requires, oauthScope: ['hr.read'] },
    });
    expect(result.success).toBe(true);
  });

  test('#16 合法 mcp:jira-prod:issue.search → 接受', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      isPreset: false,
      execute:  'mcp:jira-prod:issue.search',
      requires: { ...BASE_DESCRIPTOR.requires, oauthScope: [] },
    });
    expect(result.success).toBe(true);
  });

  test('meta.timeoutMs 范围校验 [100, 600000]', () => {
    const tooSmall = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      meta: { ...BASE_DESCRIPTOR.meta, timeoutMs: 50 },
    });
    expect(tooSmall.success).toBe(false);

    const tooBig = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      meta: { ...BASE_DESCRIPTOR.meta, timeoutMs: 700_000 },
    });
    expect(tooBig.success).toBe(false);
  });

  test('缺 name 字段 → 拒绝', () => {
    const { name: _omit, ...withoutName } = BASE_DESCRIPTOR;
    const result = ToolDescriptor.safeParse(withoutName);
    expect(result.success).toBe(false);
  });

  test('version 格式错（非 semver）→ 拒绝', () => {
    const result = ToolDescriptor.safeParse({ ...BASE_DESCRIPTOR, version: 'v1.0' });
    expect(result.success).toBe(false);
  });

  test('handlerKind 非闭集 → 拒绝', () => {
    const result = ToolDescriptor.safeParse({
      ...BASE_DESCRIPTOR,
      handler: { kind: 'grpc', config: {} },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDescriptorConsistency 单测
// ---------------------------------------------------------------------------

describe('validateDescriptorConsistency', () => {
  test('#8 meta.requiresPrincipal != requires.principal → 一致性错误', () => {
    const d = ToolDescriptor.parse({
      ...BASE_DESCRIPTOR,
      meta:     { ...BASE_DESCRIPTOR.meta, requiresPrincipal: 'USER' },
      requires: { ...BASE_DESCRIPTOR.requires, principal: 'SERVICE' },
    });
    const { ok, errors } = validateDescriptorConsistency(d);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('INVALID_ARGUMENT_DESCRIPTOR_CONSISTENCY'))).toBe(true);
  });

  test('#9 isPreset=true + execute 非 builtin: → FAILED_PRECONDITION_DESCRIPTOR_TENANT_MISMATCH', () => {
    const d = ToolDescriptor.parse({
      ...BASE_DESCRIPTOR,
      isPreset: true,
      execute:  'ext:101:hr.salary.read',
    });
    const { ok, errors } = validateDescriptorConsistency(d);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('FAILED_PRECONDITION_DESCRIPTOR_TENANT_MISMATCH'))).toBe(true);
  });

  test('#10 LONG_RUNNING output 缺 scheduled → INVALID_ARGUMENT_DESCRIPTOR_LONG_RUNNING_OUTPUT', () => {
    const d = ToolDescriptor.parse({
      ...BASE_DESCRIPTOR,
      meta: { ...BASE_DESCRIPTOR.meta, execution: 'LONG_RUNNING', consent: 'EACH_CALL', idempotent: false },
      outputSchema: {
        type:       'object',
        properties: { jobId: { type: 'string' } },
      },
    });
    const { ok, errors } = validateDescriptorConsistency(d);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('INVALID_ARGUMENT_DESCRIPTOR_LONG_RUNNING_OUTPUT'))).toBe(true);
  });

  test('#12 oauthScope 未排序 → 一致性错误', () => {
    const d = ToolDescriptor.parse({
      ...BASE_DESCRIPTOR,
      requires: { ...BASE_DESCRIPTOR.requires, oauthScope: ['z.read', 'a.read'] },
    });
    const { ok, errors } = validateDescriptorConsistency(d);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('oauthScope must be sorted ascending'))).toBe(true);
  });

  test('#13 deprecated=true 但无 deprecatedMessage → 一致性错误', () => {
    const d = ToolDescriptor.parse({
      ...BASE_DESCRIPTOR,
      deprecated:        true,
      deprecatedMessage: null,
    });
    const { ok, errors } = validateDescriptorConsistency(d);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.includes('deprecatedMessage'))).toBe(true);
  });

  test('#14 未知字段被 passthrough 忽略（前向兼容）', () => {
    const result = ToolDescriptor.safeParse({ ...BASE_DESCRIPTOR, extra: 123 });
    expect(result.success).toBe(true);
  });

  test('合法 descriptor 一致性校验通过', () => {
    const d = ToolDescriptor.parse(BASE_DESCRIPTOR);
    const { ok } = validateDescriptorConsistency(d);
    expect(ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// execute ref pattern 单测
// ---------------------------------------------------------------------------

describe('EXECUTE_REF_PATTERN', () => {
  test.each([
    ['builtin:platform.file.read',    true],
    ['builtin:memory.recall',         true],
    ['ext:101:hr.salary.read',        true],
    ['mcp:jira-prod:issue.search',    true],
    ['builtin:Platform.File.Read',    false],
    ['weird:foo',                     false],
    ['',                              false],
    ['builtin:x',                     false], // 少一个点分段
  ])('ref=%s → %s', (ref, expected) => {
    expect(EXECUTE_REF_PATTERN.test(ref)).toBe(expected);
  });
});

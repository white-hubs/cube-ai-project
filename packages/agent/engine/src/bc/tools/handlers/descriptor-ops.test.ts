/**
 * 「一核」目录与系统级 descriptor 生成的结构校验（ADR-0027 §7/§8）：
 *   - buildManagementToolDescriptors() 产出 7 个 schema-valid 系统级 ToolDescriptor；
 *   - descriptors/tools/platform.descriptor.*.yaml 经现有 loader 解析后注册成功；
 *   - in-process descriptor 声明的 consent 与 MCP confirm 策略对齐（§9）。
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ToolDescriptor } from '@cube-ai/contracts';
import {
  CONFIRM_REQUIRED_OPS,
  buildManagementToolDescriptors,
  descriptorOpFromExecute,
  managementMcpToolList,
  managementToolNames,
} from './descriptor-ops';

// Anchor to repo root via this file's location (robust to process.chdir in other tests).
const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..', '..', '..', '..');

describe('management ops core catalog', () => {
  it('builds 7 schema-valid system-level tool descriptors with descriptorOps handler', () => {
    const descriptors = buildManagementToolDescriptors();
    expect(descriptors).toHaveLength(7);
    for (const d of descriptors) {
      expect(d.handler?.kind).toBe('descriptorOps');
      expect(d.isPreset).toBe(true);
      expect(d.execute.startsWith('builtin:platform.descriptor.')).toBe(true);
      expect(descriptorOpFromExecute(d.execute)).not.toBeNull();
    }
    expect(descriptors.map((d) => d.name).sort()).toEqual([...managementToolNames()].sort());
  });

  it('consent policy: reads NEVER, drafts ON_FIRST_USE, runtime-affecting EACH_CALL + confirm', () => {
    const byName = new Map(buildManagementToolDescriptors().map((d) => [d.name, d] as const));
    expect(byName.get('platform.descriptor.list')?.meta.consent).toBe('NEVER');
    expect(byName.get('platform.descriptor.get')?.meta.consent).toBe('NEVER');
    expect(byName.get('platform.descriptor.propose')?.meta.consent).toBe('NEVER');
    expect(byName.get('platform.descriptor.create')?.meta.consent).toBe('ON_FIRST_USE');
    expect(byName.get('platform.descriptor.update')?.meta.consent).toBe('ON_FIRST_USE');
    expect(byName.get('platform.descriptor.publish')?.meta.consent).toBe('EACH_CALL');
    expect(byName.get('platform.descriptor.delete')?.meta.consent).toBe('EACH_CALL');
    expect([...CONFIRM_REQUIRED_OPS].sort()).toEqual(['delete', 'publish']);
  });

  it('MCP tools/list mirrors the same tool set with input schemas', () => {
    const list = managementMcpToolList();
    expect(list.map((t) => t.name).sort()).toEqual([...managementToolNames()].sort());
    for (const t of list) {
      expect(t.inputSchema.type).toBe('object');
    }
  });

  // NB: read via Bun.file (not node:fs/promises) so this stays deterministic even though
  // descriptor-loader.test.ts leaks a mock.module('node:fs/promises') that bun's
  // mock.restore() does not undo across files.
  it('descriptors/tools/platform.descriptor.*.yaml are schema-valid ToolDescriptors', async () => {
    const dir = join(REPO_ROOT, 'descriptors', 'tools');
    for (const name of managementToolNames()) {
      const raw = await Bun.file(join(dir, `${name}.yaml`)).text();
      const parsed = ToolDescriptor.safeParse(parseYaml(raw));
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.name).toBe(name);
        expect(parsed.data.handler?.kind).toBe('descriptorOps');
        expect(descriptorOpFromExecute(parsed.data.execute)).not.toBeNull();
      }
    }
  });
});

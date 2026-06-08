/**
 * DescriptorRegistry：启动期 Tool Descriptor 注册 + 版本单调检查 + duplicate 检测。
 *
 * 权威来源：
 *   docs/detailed-design/07-tools/registration-lifecycle.md §2.2 / §4
 *   docs/detailed-design/07-tools/descriptor-schema.md §10（关键不变式）
 *   docs/technical-design/prompts/phase-1/P1-08-tools.md §6.2
 *   ADR-0007 D1（版本化）/ D2（快照绑定）
 *
 * Phase 3（P3-11）：扩展 get / list / getEffectiveVersion；支持 Nacos 全量快照替换。
 */
import { Inject, Injectable } from '@dangao/bun-server';
import {
  type ToolDescriptor,
  validateDescriptorConsistency,
} from '@cube-ai/contracts';
import { AgenticEngineError } from '../../infra/errors/agentic-error';
import {
  TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN,
  type ToolEffectiveVersionSource,
} from './tool-effective-version.provider';

/** semver 简单比较（只支持 x.y.z 格式）*/
function semverCompare(a: string, b: string): number {
  const parse = (v: string): [number, number, number] => {
    const parts = v.split('.').map(Number);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  };
  const [am, ai, ap] = parse(a);
  const [bm, bi, bp] = parse(b);
  if (am !== bm) return am - bm;
  if (ai !== bi) return ai - bi;
  return ap - bp;
}

export interface DescriptorListFilter {
  /** 按 ToolDescriptor.category（PLATFORM | MEMORY | CUSTOM | MCP）过滤 */
  category?: string;
  /** tags 需全部命中（descriptor.tags 包含） */
  tags?: string[];
}

@Injectable()
export class DescriptorRegistryService {
  /** key = `${name}@${version}` — registration-lifecycle.md §4.2 */
  private readonly byKey = new Map<string, ToolDescriptor>();
  /** name → latest version string */
  private readonly latestByName = new Map<string, string>();

  constructor(
    @Inject(TOOL_EFFECTIVE_VERSION_SOURCE_TOKEN)
    private readonly pinSource: ToolEffectiveVersionSource,
  ) {}

  /**
   * 注册一个 ToolDescriptor。
   *
   * 规则（P1-08-tools.md §3.4 / registration-lifecycle.md §2.2）：
   *  1. 跨字段一致性校验（descriptor-schema.md §8.5）
   *  2. 同 name+version duplicate → throw RESOURCE_CONFLICT_DESCRIPTOR_DUPLICATE
   *  3. 版本单调（ADR-0007 D1）：新版本必须 > 已知最新版本
   */
  register(d: ToolDescriptor): void {
    const { ok, errors } = validateDescriptorConsistency(d);
    if (!ok) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_DESCRIPTOR_CONSISTENCY',
        errors.join('; '),
      );
    }

    const version = d.version ?? '1.0.0';
    const key = `${d.name}@${version}`;

    if (this.byKey.has(key)) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_CONFLICT_DESCRIPTOR_DUPLICATE',
        `Duplicate descriptor: ${key}`,
      );
    }

    const prev = this.latestByName.get(d.name);
    if (prev !== undefined && semverCompare(version, prev) <= 0) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_CONFLICT_DESCRIPTOR_VERSION_NOT_MONOTONIC',
        `Descriptor ${d.name}: version ${version} is not monotonically greater than ${prev}`,
      );
    }

    this.byKey.set(key, d);
    this.latestByName.set(d.name, version);
  }

  /**
   * Nacos / 目录全量热更：清空后按版本递增顺序重新注册。
   */
  replaceAllFromSnapshot(descriptors: ToolDescriptor[]): void {
    this.clear();
    const byName = new Map<string, ToolDescriptor[]>();
    for (const d of descriptors) {
      const list = byName.get(d.name) ?? [];
      list.push(d);
      byName.set(d.name, list);
    }
    for (const [, list] of byName) {
      list.sort((a, b) =>
        semverCompare(a.version ?? '1.0.0', b.version ?? '1.0.0'),
      );
      for (const d of list) {
        this.register(d);
      }
    }
  }

  /**
   * `name`、`name@version` 或仅 version 片段：返回 descriptor；缺失抛 RESOURCE_NOT_FOUND_DESCRIPTOR。
   */
  get(nameOrVersion: string): ToolDescriptor {
    const trimmed = nameOrVersion.trim();
    if (!trimmed) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        'Empty descriptor key',
      );
    }

    if (trimmed.includes('@')) {
      const at = trimmed.lastIndexOf('@');
      const name = trimmed.slice(0, at);
      const ver = trimmed.slice(at + 1);
      const d = this.byKey.get(`${name}@${ver}`);
      if (!d) {
        throw AgenticEngineError.fromCode(
          'RESOURCE_NOT_FOUND_DESCRIPTOR',
          `Descriptor not found: ${trimmed}`,
        );
      }
      return d;
    }

    const latest = this.latestByName.get(trimmed);
    if (!latest) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `Descriptor not found: ${trimmed}`,
      );
    }
    const hit = this.byKey.get(`${trimmed}@${latest}`);
    if (!hit) {
      throw AgenticEngineError.fromCode(
        'RESOURCE_NOT_FOUND_DESCRIPTOR',
        `Descriptor not found: ${trimmed}`,
      );
    }
    return hit;
  }

  /**
   * 按 category / tags 过滤（AND：category 命中且 tags 全包含）。
   */
  list(filter?: DescriptorListFilter): ToolDescriptor[] {
    let rows = Array.from(this.byKey.values());
    if (!filter) return rows;

    if (filter.category) {
      rows = rows.filter((d) => d.category === filter.category);
    }
    if (filter.tags && filter.tags.length > 0) {
      const need = filter.tags;
      rows = rows.filter((d) => {
        const tags = d.tags ?? [];
        return need.every((t) => tags.includes(t));
      });
    }
    return rows;
  }

  /**
   * 当前生效版本：优先 Nacos `agentic-engine-tool-versions`，否则 registry 最新。
   */
  async getEffectiveVersion(toolName: string): Promise<string | undefined> {
    const pinned = await this.pinSource?.getPinnedVersion(toolName);
    if (pinned) return pinned;
    return this.latestByName.get(toolName);
  }

  /**
   * 解析 ToolDescriptor。
   * - version 为空 → 返回最新版本
   * - version 指定 → 精确匹配
   *
   * 对齐 registration-lifecycle.md §4.2 L1 查询路径。
   */
  resolve(name: string, version?: string): ToolDescriptor | undefined {
    if (version) {
      return this.byKey.get(`${name}@${version}`);
    }
    const latest = this.latestByName.get(name);
    if (!latest) return undefined;
    return this.byKey.get(`${name}@${latest}`);
  }

  listAll(): ToolDescriptor[] {
    return Array.from(this.byKey.values());
  }

  size(): number {
    return this.byKey.size;
  }

  /** 清空注册表（用于测试 teardown / Nacos 热更）*/
  clear(): void {
    this.byKey.clear();
    this.latestByName.clear();
  }
}

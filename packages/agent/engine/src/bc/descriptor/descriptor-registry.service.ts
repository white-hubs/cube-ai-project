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
 * 版本索引/单调不变量收敛于 {@link VersionedRegistry}。
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
import { VersionedRegistry } from './versioned-registry';

export interface DescriptorListFilter {
  /** 按 ToolDescriptor.category（PLATFORM | MEMORY | CUSTOM | MCP）过滤 */
  category?: string;
  /** tags 需全部命中（descriptor.tags 包含） */
  tags?: string[];
}

@Injectable()
export class DescriptorRegistryService {
  private readonly registry = new VersionedRegistry<ToolDescriptor>({
    itemName: (d) => d.name,
    itemVersion: (d) => d.version,
    defaultVersion: '1.0.0',
    // 跨字段一致性校验（descriptor-schema.md §8.5）
    validate: (d) => {
      const { ok, errors } = validateDescriptorConsistency(d);
      if (!ok) {
        throw AgenticEngineError.fromCode(
          'INVALID_ARGUMENT_DESCRIPTOR_CONSISTENCY',
          errors.join('; '),
        );
      }
    },
    duplicateError: (key) =>
      AgenticEngineError.fromCode(
        'RESOURCE_CONFLICT_DESCRIPTOR_DUPLICATE',
        `Duplicate descriptor: ${key}`,
      ),
    nonMonotonicError: (name, version, prev) =>
      AgenticEngineError.fromCode(
        'RESOURCE_CONFLICT_DESCRIPTOR_VERSION_NOT_MONOTONIC',
        `Descriptor ${name}: version ${version} is not monotonically greater than ${prev}`,
      ),
  });

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
    this.registry.register(d);
  }

  /**
   * Nacos / 目录全量热更：清空后按版本递增顺序重新注册。
   */
  replaceAllFromSnapshot(descriptors: ToolDescriptor[]): void {
    this.registry.replaceAllFromSnapshot(descriptors);
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

    let hit: ToolDescriptor | undefined;
    if (trimmed.includes('@')) {
      const at = trimmed.lastIndexOf('@');
      hit = this.registry.resolve(trimmed.slice(0, at), trimmed.slice(at + 1));
    } else {
      hit = this.registry.resolve(trimmed);
    }
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
    let rows = this.registry.all();
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
    return this.registry.latestVersionOf(toolName);
  }

  /**
   * 解析 ToolDescriptor。
   * - version 为空 → 返回最新版本
   * - version 指定 → 精确匹配
   *
   * 对齐 registration-lifecycle.md §4.2 L1 查询路径。
   */
  resolve(name: string, version?: string): ToolDescriptor | undefined {
    return this.registry.resolve(name, version);
  }

  listAll(): ToolDescriptor[] {
    return this.registry.all();
  }

  size(): number {
    return this.registry.size();
  }

  /** 清空注册表（用于测试 teardown / Nacos 热更）*/
  clear(): void {
    this.registry.clear();
  }
}

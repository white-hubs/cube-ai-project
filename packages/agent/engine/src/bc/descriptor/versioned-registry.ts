/**
 * VersionedRegistry —— 版本化内存注册表的唯一实现。
 *
 * 不变量（原先在 SkillRegistryService / DescriptorRegistryService 各持一份拷贝）：
 *   - `name@version` 双索引（byKey + latestByName）
 *   - register 时 duplicate 检测 + 版本单调检查（ADR-0007 D1）
 *   - 全量快照替换：清空后按 name 分组、版本升序重新注册
 *
 * 错误语义按实体类型注入（skill 用裸 Error，tool 用 AgenticEngineError），
 * 注册前校验（如 tool 的跨字段一致性）经 `validate` 钩子注入。
 */

/** semver 简单比较（只支持 x.y.z 格式） */
export function semverCompare(a: string, b: string): number {
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

export interface VersionedRegistryConfig<T> {
  itemName: (item: T) => string;
  itemVersion: (item: T) => string | undefined;
  /** version 缺省时使用（skill: '0.0.0'，tool: '1.0.0'） */
  defaultVersion: string;
  /** register 前校验钩子；抛错即拒绝注册 */
  validate?: (item: T) => void;
  duplicateError: (key: string) => Error;
  nonMonotonicError: (name: string, version: string, prev: string) => Error;
}

export class VersionedRegistry<T> {
  /** key = `${name}@${version}` */
  private readonly byKey = new Map<string, T>();
  /** name → latest version string */
  private readonly latestByName = new Map<string, string>();

  constructor(private readonly config: VersionedRegistryConfig<T>) {}

  register(item: T): void {
    this.config.validate?.(item);

    const name = this.config.itemName(item);
    const version = this.config.itemVersion(item) ?? this.config.defaultVersion;
    const key = `${name}@${version}`;

    if (this.byKey.has(key)) {
      throw this.config.duplicateError(key);
    }
    const prev = this.latestByName.get(name);
    if (prev !== undefined && semverCompare(version, prev) <= 0) {
      throw this.config.nonMonotonicError(name, version, prev);
    }

    this.byKey.set(key, item);
    this.latestByName.set(name, version);
  }

  /** 全量热更：清空后按 name 分组、版本升序重新注册（保持单调检查生效）。 */
  replaceAllFromSnapshot(items: T[]): void {
    this.clear();
    const byName = new Map<string, T[]>();
    for (const item of items) {
      const name = this.config.itemName(item);
      const list = byName.get(name) ?? [];
      list.push(item);
      byName.set(name, list);
    }
    for (const list of byName.values()) {
      list.sort((a, b) =>
        semverCompare(
          this.config.itemVersion(a) ?? this.config.defaultVersion,
          this.config.itemVersion(b) ?? this.config.defaultVersion,
        ),
      );
      for (const item of list) this.register(item);
    }
  }

  /** version 缺省 → 最新版本；指定 → 精确匹配。 */
  resolve(name: string, version?: string): T | undefined {
    if (version) return this.byKey.get(`${name}@${version}`);
    const latest = this.latestByName.get(name);
    if (!latest) return undefined;
    return this.byKey.get(`${name}@${latest}`);
  }

  latestVersionOf(name: string): string | undefined {
    return this.latestByName.get(name);
  }

  /** 每个 name 的最新版本条目，按 name 升序。 */
  latest(): T[] {
    const out: T[] = [];
    for (const [name, version] of this.latestByName.entries()) {
      const item = this.byKey.get(`${name}@${version}`);
      if (item) out.push(item);
    }
    return out.sort((a, b) =>
      this.config.itemName(a).localeCompare(this.config.itemName(b)),
    );
  }

  /** 全部版本条目。 */
  all(): T[] {
    return Array.from(this.byKey.values());
  }

  size(): number {
    return this.byKey.size;
  }

  clear(): void {
    this.byKey.clear();
    this.latestByName.clear();
  }
}

import { Injectable } from '@dangao/bun-server';
import { VersionedRegistry } from './versioned-registry';

/**
 * 系统级 rule descriptor（`descriptors/rules/*.yaml`，kind: rule）。
 * 租户级 rule（`rul_` 前缀）走 tenant-descriptor 持久层（ADR-0016），不进本注册表。
 */
export interface RuleDescriptor {
  kind: 'rule';
  name: string;
  /** 注入 system prompt 的规则文本 */
  content: string;
  version?: string;
  description?: string;
  displayName?: string;
  tags?: string[];
}

@Injectable()
export class RuleRegistryService {
  private readonly registry = new VersionedRegistry<RuleDescriptor>({
    itemName: (r) => r.name,
    itemVersion: (r) => r.version,
    defaultVersion: '0.0.0',
    duplicateError: (key) => new Error(`Duplicate rule descriptor: ${key}`),
    nonMonotonicError: (name, version, prev) =>
      new Error(
        `Rule ${name}: version ${version} is not monotonically greater than ${prev}`,
      ),
  });

  register(rule: RuleDescriptor): void {
    this.registry.register(rule);
  }

  replaceAllFromSnapshot(rules: RuleDescriptor[]): void {
    this.registry.replaceAllFromSnapshot(rules);
  }

  resolve(name: string, version?: string): RuleDescriptor | undefined {
    return this.registry.resolve(name, version);
  }

  list(): RuleDescriptor[] {
    return this.registry.latest();
  }

  size(): number {
    return this.registry.size();
  }

  clear(): void {
    this.registry.clear();
  }
}

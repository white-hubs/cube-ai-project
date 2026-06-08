import { Injectable } from '@dangao/bun-server';
import type { SkillDescriptor } from '@tachu/core';

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

function stableSkillSignature(skill: SkillDescriptor): string {
  return JSON.stringify({
    name: skill.name,
    version: skill.version ?? '0.0.0',
    description: skill.description,
    displayName: skill.displayName,
    deprecated: skill.deprecated,
    deprecatedMessage: skill.deprecatedMessage,
    tags: skill.tags ?? [],
    trigger: skill.trigger ?? { type: 'semantic' },
    requires: skill.requires ?? [],
    resources: skill.resources ?? [],
    sourceDir: skill.sourceDir,
    instructions: skill.instructions,
  });
}

@Injectable()
export class SkillRegistryService {
  private readonly byKey = new Map<string, SkillDescriptor>();
  private readonly latestByName = new Map<string, string>();

  register(skill: SkillDescriptor): void {
    const version = skill.version ?? '0.0.0';
    const key = `${skill.name}@${version}`;
    if (this.byKey.has(key)) {
      throw new Error(`Duplicate skill descriptor: ${key}`);
    }
    const prev = this.latestByName.get(skill.name);
    if (prev !== undefined && semverCompare(version, prev) <= 0) {
      throw new Error(
        `Skill ${skill.name}: version ${version} is not monotonically greater than ${prev}`,
      );
    }
    this.byKey.set(key, skill);
    this.latestByName.set(skill.name, version);
  }

  replaceAllFromSnapshot(skills: SkillDescriptor[]): void {
    this.clear();
    const byName = new Map<string, SkillDescriptor[]>();
    for (const skill of skills) {
      const list = byName.get(skill.name) ?? [];
      list.push(skill);
      byName.set(skill.name, list);
    }
    for (const list of byName.values()) {
      list.sort((a, b) =>
        semverCompare(a.version ?? '0.0.0', b.version ?? '0.0.0'),
      );
      for (const skill of list) this.register(skill);
    }
  }

  resolve(name: string, version?: string): SkillDescriptor | undefined {
    if (version) return this.byKey.get(`${name}@${version}`);
    const latest = this.latestByName.get(name);
    if (!latest) return undefined;
    return this.byKey.get(`${name}@${latest}`);
  }

  list(): SkillDescriptor[] {
    const out: SkillDescriptor[] = [];
    for (const [name, version] of this.latestByName.entries()) {
      const skill = this.byKey.get(`${name}@${version}`);
      if (skill) out.push(skill);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  signature(): string {
    return this.list().map(stableSkillSignature).join('|');
  }

  size(): number {
    return this.byKey.size;
  }

  clear(): void {
    this.byKey.clear();
    this.latestByName.clear();
  }
}

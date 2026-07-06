import { Injectable } from "@dangao/bun-server";
import type { SkillDescriptor } from "@tachu/core";

import { VersionedRegistry } from "./versioned-registry";

function stableSkillSignature(skill: SkillDescriptor): string {
  return JSON.stringify({
    name: skill.name,
    version: skill.version ?? "0.0.0",
    description: skill.description,
    displayName: skill.displayName,
    deprecated: skill.deprecated,
    deprecatedMessage: skill.deprecatedMessage,
    tags: skill.tags ?? [],
    activation: skill.activation ?? { mode: "semantic" },
    requires: skill.requires ?? [],
    resources: skill.resources ?? [],
    sourceDir: skill.sourceDir,
    instructions: skill.instructions,
  });
}

@Injectable()
export class SkillRegistryService {
  private readonly registry = new VersionedRegistry<SkillDescriptor>({
    itemName: (s) => s.name,
    itemVersion: (s) => s.version,
    defaultVersion: "0.0.0",
    duplicateError: (key) => new Error(`Duplicate skill descriptor: ${key}`),
    nonMonotonicError: (name, version, prev) => new Error(`Skill ${name}: version ${version} is not monotonically greater than ${prev}`),
  });

  register(skill: SkillDescriptor): void {
    this.registry.register(skill);
  }

  replaceAllFromSnapshot(skills: SkillDescriptor[]): void {
    this.registry.replaceAllFromSnapshot(skills);
  }

  resolve(name: string, version?: string): SkillDescriptor | undefined {
    return this.registry.resolve(name, version);
  }

  list(): SkillDescriptor[] {
    return this.registry.latest();
  }

  signature(): string {
    return this.list().map(stableSkillSignature).join("|");
  }

  size(): number {
    return this.registry.size();
  }

  clear(): void {
    this.registry.clear();
  }
}

import { beforeEach, describe, expect, test } from 'bun:test';
import type { SkillDescriptor } from '@tachu/core';
import { SkillRegistryService } from './skill-registry.service';

function makeSkill(override: Partial<SkillDescriptor> = {}): SkillDescriptor {
  return {
    kind: 'skill',
    name: 'default-reasoning',
    version: '1.0.0',
    description: 'Default reasoning behavior',
    instructions: 'Think clearly and answer concisely.',
    trigger: { type: 'semantic' },
    ...override,
  };
}

describe('SkillRegistryService', () => {
  let registry: SkillRegistryService;

  beforeEach(() => {
    registry = new SkillRegistryService();
  });

  test('register and resolve latest skill by name', () => {
    registry.register(makeSkill({ version: '1.0.0' }));
    registry.register(makeSkill({ version: '1.1.0', instructions: 'new body' }));

    expect(registry.resolve('default-reasoning')?.version).toBe('1.1.0');
    expect(registry.resolve('default-reasoning', '1.0.0')?.instructions).toContain(
      'Think clearly',
    );
  });

  test('rejects duplicate name and version', () => {
    registry.register(makeSkill({ version: '1.0.0' }));
    expect(() => registry.register(makeSkill({ version: '1.0.0' }))).toThrow(
      /Duplicate skill descriptor/,
    );
  });

  test('signature changes when instructions change without a version bump', () => {
    registry.replaceAllFromSnapshot([
      makeSkill({ name: 'chart-output', version: '1.0.0', instructions: 'body-a' }),
    ]);
    const first = registry.signature();

    registry.replaceAllFromSnapshot([
      makeSkill({ name: 'chart-output', version: '1.0.0', instructions: 'body-b' }),
    ]);
    expect(registry.signature()).not.toBe(first);
  });
});

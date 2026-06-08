import { describe, expect, test } from 'bun:test';
import type { SkillDescriptor } from '@tachu/core';
import {
  hydrateSnapshotSkills,
  snapshotSkillsToDescriptors,
} from './snapshot-skill-hydration';

const chartSkill: SkillDescriptor = {
  kind: 'skill',
  name: 'chart-output',
  version: '1.0.2',
  description: 'Use when charts are needed',
  instructions: 'Use only the `echarts` language label.',
  trigger: { type: 'semantic' },
};

describe('snapshot-skill-hydration', () => {
  test('hydrateSnapshotSkills resolves refs into frozen rows', () => {
    const registry = {
      resolve: (name: string) => (name === 'chart-output' ? chartSkill : undefined),
    };
    const rows = hydrateSnapshotSkills(['chart-output'], registry);
    expect(rows.length).toBe(1);
    expect(rows[0]?.name).toBe('chart-output');
    expect(rows[0]?.content.instructions).toContain('echarts');
    expect(rows[0]?.content).not.toBe(chartSkill);
  });

  test('hydrateSnapshotSkills throws when ref missing', () => {
    expect(() => hydrateSnapshotSkills(['missing'], { resolve: () => undefined })).toThrow();
  });

  test('snapshotSkillsToDescriptors reads content from inline rows', () => {
    const rows = hydrateSnapshotSkills(['chart-output'], {
      resolve: () => chartSkill,
    });
    const descriptors = snapshotSkillsToDescriptors(rows);
    expect(descriptors.length).toBe(1);
    expect(descriptors[0]?.name).toBe('chart-output');
  });
});

import { describe, expect, test } from 'bun:test';
import { resolveSkillEmbeddingModelCode } from './skill-embedding-config';

describe('resolveSkillEmbeddingModelCode', () => {
  const prev = process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'];

  test('turn override wins over env', () => {
    process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'] = 'text-embedding-3-small';
    expect(
      resolveSkillEmbeddingModelCode({ turnModelCode: 'text-embedding-3-large' }),
    ).toBe('text-embedding-3-large');
  });

  test('falls back to env when turn omitted', () => {
    process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'] = 'text-embedding-3-small';
    expect(resolveSkillEmbeddingModelCode()).toBe('text-embedding-3-small');
  });

  test('returns undefined when unset', () => {
    delete process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'];
    expect(resolveSkillEmbeddingModelCode()).toBeUndefined();
  });

  test('restore env', () => {
    if (prev === undefined) {
      delete process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'];
    } else {
      process.env['AGENTIC_ENGINE_SKILL_EMBEDDING_MODEL'] = prev;
    }
    expect(true).toBe(true);
  });
});

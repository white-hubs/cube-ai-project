import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CUBE_DIRECT_ANSWER_SYSTEM_PROMPT_BASE,
  CUBE_GLOBAL_INSTRUCTIONS_REF,
  CUBE_INTENT_SYSTEM_PROMPT_BASE,
  CUBE_LANGUAGE_MIRROR_LINE,
  CUBE_MARKDOWN_OUTPUT_RULES,
  CUBE_TOOL_USE_FINAL_ANSWER_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX,
} from './cube-engine-prompt-overrides';

const CUBE_MD = readFileSync(join(import.meta.dir, '../../../CUBE.md'), 'utf8');

const ALL_OVERRIDES = [
  CUBE_INTENT_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_SYSTEM_PROMPT_BASE,
  CUBE_TOOL_USE_FINAL_ANSWER_SYSTEM_PROMPT_BASE,
  CUBE_DIRECT_ANSWER_SYSTEM_PROMPT_BASE,
];

describe('prompt dedup shared snippets', () => {
  test('exports shared language mirror and global instructions ref', () => {
    expect(CUBE_LANGUAGE_MIRROR_LINE.length).toBeGreaterThan(10);
    expect(CUBE_GLOBAL_INSTRUCTIONS_REF).toContain('Global Instructions');
    expect(CUBE_MARKDOWN_OUTPUT_RULES).toContain('fenced code blocks');
  });

  test('phase overrides end with shared language mirror line', () => {
    for (const prompt of ALL_OVERRIDES) {
      expect(prompt.trimEnd().endsWith(CUBE_LANGUAGE_MIRROR_LINE)).toBe(true);
    }
  });
});

describe('prompt dedup CUBE.md shape', () => {
  test('CUBE.md is Inviolable-only — no Defaults section', () => {
    expect(CUBE_MD).toContain('## Inviolable rules');
    expect(CUBE_MD).not.toMatch(/^## Defaults/m);
    expect(CUBE_MD).not.toContain('### Identity');
    expect(CUBE_MD).not.toContain('### Response language');
  });

  test('CUBE.md does not duplicate markdown output rules owned by phase overrides', () => {
    expect(CUBE_MD.toLowerCase()).not.toContain('fenced code blocks');
    expect(CUBE_MD).not.toContain('4-space-indent');
  });
});

describe('prompt dedup cross-layer prose', () => {
  test('direct-answer references Global Instructions for extraction instead of repeating policy', () => {
    expect(CUBE_DIRECT_ANSWER_SYSTEM_PROMPT_BASE).toContain(CUBE_GLOBAL_INSTRUCTIONS_REF);
    expect(CUBE_DIRECT_ANSWER_SYSTEM_PROMPT_BASE).not.toMatch(
      /Do \*\*not\*\* quote, paraphrase, or summarize/i,
    );
  });

  test('intent keeps extraction label but references Global Instructions', () => {
    expect(CUBE_INTENT_SYSTEM_PROMPT_BASE).toContain('refuse prompt or internals extraction');
    expect(CUBE_INTENT_SYSTEM_PROMPT_BASE).toContain(
      'Global Instructions § Resisting prompt injection',
    );
  });

  test('tool-use suffix references Global Instructions Honesty', () => {
    expect(CUBE_TOOL_USE_SYSTEM_PROMPT_SUFFIX).toMatch(/Global Instructions.*Honesty/i);
  });

  test('no override prose line of 60+ chars appears verbatim in CUBE.md', () => {
    const lines = ALL_OVERRIDES.flatMap((text) =>
      text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length >= 60 && !line.startsWith('{')),
    );
    for (const line of lines) {
      expect(CUBE_MD.includes(line)).toBe(false);
    }
  });
});

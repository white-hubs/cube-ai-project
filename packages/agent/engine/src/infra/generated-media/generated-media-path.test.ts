import { describe, expect, test } from 'bun:test';
import { normalizeGeneratedMediaPathPrefix } from './generated-media-path';

describe('normalizeGeneratedMediaPathPrefix', () => {
  test('defaults to /agentic/media', () => {
    expect(normalizeGeneratedMediaPathPrefix(undefined)).toBe('/agentic/media');
    expect(normalizeGeneratedMediaPathPrefix('')).toBe('/agentic/media');
  });

  test('adds leading slash and trims trailing slashes', () => {
    expect(normalizeGeneratedMediaPathPrefix('custom/x/')).toBe('/custom/x');
    expect(normalizeGeneratedMediaPathPrefix('/media/gen/')).toBe('/media/gen');
  });
});

import { describe, test, expect } from 'bun:test';
import { LengthPolicy } from './length-policy';

describe('LengthPolicy', () => {
  test('policy name is "length-check"', () => {
    expect(new LengthPolicy().name).toBe('length-check');
  });

  test('text > maxBytes → deny', () => {
    const policy = new LengthPolicy({ maxBytes: 5 });
    const r = policy.evaluate({ text: 'toolong' }); // 7 chars
    expect(r.kind).toBe('deny');
    expect((r as { kind: 'deny'; reason: string }).reason).toMatch(/exceeds/);
  });

  test('text = maxBytes exactly → allow (boundary)', () => {
    const policy = new LengthPolicy({ maxBytes: 5 });
    const r = policy.evaluate({ text: 'exact' }); // exactly 5 bytes
    expect(r.kind).toBe('allow');
  });

  test('text < maxBytes → allow', () => {
    const policy = new LengthPolicy({ maxBytes: 100 });
    const r = policy.evaluate({ text: 'short' });
    expect(r.kind).toBe('allow');
  });

  test('empty string → allow', () => {
    const policy = new LengthPolicy({ maxBytes: 10 });
    expect(policy.evaluate({ text: '' }).kind).toBe('allow');
  });

  test('default maxBytes is 100 KiB', () => {
    const policy = new LengthPolicy();
    // Create exactly 100*1024 bytes
    const okText = 'a'.repeat(100 * 1024);
    expect(policy.evaluate({ text: okText }).kind).toBe('allow');
    // One byte over
    const tooBig = 'a'.repeat(100 * 1024 + 1);
    expect(policy.evaluate({ text: tooBig }).kind).toBe('deny');
  });

  test('multibyte UTF-8 chars counted correctly', () => {
    // '中' is 3 UTF-8 bytes
    const policy = new LengthPolicy({ maxBytes: 5 });
    const twoChars = '中中'; // 6 bytes → deny
    expect(policy.evaluate({ text: twoChars }).kind).toBe('deny');
    const oneChar = '中'; // 3 bytes → allow
    expect(policy.evaluate({ text: oneChar }).kind).toBe('allow');
  });
});

import { describe, expect, it } from 'bun:test';
import { semverCompare, VersionedRegistry } from './versioned-registry';

interface Item {
  name: string;
  version?: string;
  payload?: string;
}

function makeRegistry(validate?: (item: Item) => void) {
  return new VersionedRegistry<Item>({
    itemName: (i) => i.name,
    itemVersion: (i) => i.version,
    defaultVersion: '0.0.0',
    validate,
    duplicateError: (key) => new Error(`dup:${key}`),
    nonMonotonicError: (name, version, prev) =>
      new Error(`mono:${name}:${version}<=${prev}`),
  });
}

describe('semverCompare', () => {
  it('orders by major/minor/patch', () => {
    expect(semverCompare('1.0.0', '0.9.9')).toBeGreaterThan(0);
    expect(semverCompare('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(semverCompare('1.2.3', '1.2.3')).toBe(0);
  });

  it('treats missing segments as 0', () => {
    expect(semverCompare('1', '1.0.0')).toBe(0);
    expect(semverCompare('1.1', '1.0.5')).toBeGreaterThan(0);
  });
});

describe('VersionedRegistry', () => {
  it('registers and resolves latest / exact version', () => {
    const r = makeRegistry();
    r.register({ name: 'a', version: '1.0.0', payload: 'old' });
    r.register({ name: 'a', version: '1.1.0', payload: 'new' });

    expect(r.resolve('a')?.payload).toBe('new');
    expect(r.resolve('a', '1.0.0')?.payload).toBe('old');
    expect(r.resolve('a', '9.9.9')).toBeUndefined();
    expect(r.resolve('missing')).toBeUndefined();
    expect(r.latestVersionOf('a')).toBe('1.1.0');
    expect(r.size()).toBe(2);
  });

  it('applies defaultVersion when item version is missing', () => {
    const r = makeRegistry();
    r.register({ name: 'a' });
    expect(r.resolve('a', '0.0.0')).toBeDefined();
  });

  it('rejects duplicate name@version', () => {
    const r = makeRegistry();
    r.register({ name: 'a', version: '1.0.0' });
    expect(() => r.register({ name: 'a', version: '1.0.0' })).toThrow('dup:a@1.0.0');
  });

  it('rejects non-monotonic versions', () => {
    const r = makeRegistry();
    r.register({ name: 'a', version: '2.0.0' });
    expect(() => r.register({ name: 'a', version: '1.9.0' })).toThrow(
      'mono:a:1.9.0<=2.0.0',
    );
  });

  it('runs validate hook before any mutation', () => {
    const r = makeRegistry((item) => {
      if (item.payload === 'bad') throw new Error('invalid');
    });
    expect(() => r.register({ name: 'a', version: '1.0.0', payload: 'bad' })).toThrow(
      'invalid',
    );
    expect(r.size()).toBe(0);
  });

  it('replaceAllFromSnapshot re-registers in ascending version order', () => {
    const r = makeRegistry();
    r.register({ name: 'stale', version: '9.0.0' });

    // 乱序输入也能通过单调检查（先分组排序再注册）
    r.replaceAllFromSnapshot([
      { name: 'a', version: '2.0.0', payload: 'a2' },
      { name: 'b', version: '1.0.0' },
      { name: 'a', version: '1.0.0', payload: 'a1' },
    ]);

    expect(r.resolve('stale')).toBeUndefined();
    expect(r.resolve('a')?.payload).toBe('a2');
    expect(r.size()).toBe(3);
  });

  it('latest() returns one entry per name sorted by name', () => {
    const r = makeRegistry();
    r.register({ name: 'b', version: '1.0.0' });
    r.register({ name: 'a', version: '1.0.0' });
    r.register({ name: 'a', version: '2.0.0' });

    const latest = r.latest();
    expect(latest.map((i) => `${i.name}@${i.version}`)).toEqual(['a@2.0.0', 'b@1.0.0']);
    expect(r.all()).toHaveLength(3);
  });

  it('clear() empties both indexes', () => {
    const r = makeRegistry();
    r.register({ name: 'a', version: '1.0.0' });
    r.clear();
    expect(r.size()).toBe(0);
    r.register({ name: 'a', version: '0.5.0' }); // 单调检查随 clear 重置
    expect(r.resolve('a')).toBeDefined();
  });
});

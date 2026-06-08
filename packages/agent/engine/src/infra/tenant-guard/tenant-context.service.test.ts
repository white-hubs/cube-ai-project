import { describe, expect, test } from 'bun:test';
import { TenantContextService, TenantContextMissingError } from './tenant-context.service';

// ref: docs/technical-design/phase-1/P1-01-foundations.md §7

describe('TenantContextService', () => {
  let service: TenantContextService;

  function newService() {
    return new TenantContextService();
  }

  test('current() returns undefined outside run()', () => {
    service = newService();
    expect(service.current()).toBeUndefined();
  });

  test('run() sets current() to the given tenant inside the callback', () => {
    service = newService();
    const seen: (number | undefined)[] = [];
    service.run(42, () => {
      seen.push(service.current());
    });
    expect(seen).toEqual([42]);
  });

  test('current() reverts to undefined after run() completes', () => {
    service = newService();
    service.run(99, () => {});
    expect(service.current()).toBeUndefined();
  });

  test('run() propagates tenant across await boundaries', async () => {
    service = newService();
    const result = await service.run(7, async () => {
      await Promise.resolve();
      return service.current();
    });
    expect(result).toBe(7);
  });

  test('run() propagates tenant to all Promise.all branches', async () => {
    service = newService();
    const results = await service.run(55, async () => {
      return Promise.all([
        Promise.resolve(service.current()),
        Promise.resolve(service.current()),
        new Promise<number | undefined>(resolve => setTimeout(() => resolve(service.current()), 0)),
      ]);
    });
    expect(results).toEqual([55, 55, 55]);
  });

  test('nested run() overrides tenant for its subtree', () => {
    service = newService();
    let inner: number | undefined;
    let outer: number | undefined;
    service.run(10, () => {
      service.run(20, () => {
        inner = service.current();
      });
      outer = service.current();
    });
    expect(inner).toBe(20);
    expect(outer).toBe(10);
  });

  test('require() returns tenant when inside run()', () => {
    service = newService();
    let got: number | undefined;
    service.run(33, () => {
      got = service.require();
    });
    expect(got).toBe(33);
  });

  test('require() throws TenantContextMissingError outside run()', () => {
    service = newService();
    expect(() => service.require()).toThrow(TenantContextMissingError);
  });

  // T10: error message must remain stable for log/diagnostics tooling.
  test('require() error message contains "No tenant context active"', () => {
    service = newService();
    expect(() => service.require()).toThrow('No tenant context active');
  });

  test('TenantContextMissingError is instanceof Error', () => {
    const err = new TenantContextMissingError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TenantContextMissingError');
  });
});

import { describe, test, expect } from 'bun:test';
import { ISOLATION_MATRIX, readPath } from './isolation-matrix';

describe('ISOLATION_MATRIX', () => {
  test('has at least 6 entries (matches M1 design doc §5.2)', () => {
    expect(Object.keys(ISOLATION_MATRIX).length).toBeGreaterThanOrEqual(6);
  });

  test('every entry has a non-empty tenantPath', () => {
    for (const [key, entry] of Object.entries(ISOLATION_MATRIX)) {
      expect(entry.tenantPath).toBeTruthy();
      expect(typeof entry.tenantPath).toBe('string');
      void key;
    }
  });

  test('every entry has a valid storage layer', () => {
    const validStorages = ['mysql', 'redis', 'qdrant', 'bullmq', 'outbox'];
    for (const [key, entry] of Object.entries(ISOLATION_MATRIX)) {
      expect(validStorages).toContain(entry.storage);
      void key;
    }
  });

  test('covers all 4 required storage layers', () => {
    const storages = new Set(Object.values(ISOLATION_MATRIX).map((e) => e.storage));
    expect(storages.has('mysql')).toBe(true);
    expect(storages.has('redis')).toBe(true);
    expect(storages.has('qdrant')).toBe(true);
    expect(storages.has('bullmq')).toBe(true);
  });

  test('session resource has mysql storage + tenantPath=tenant', () => {
    expect(ISOLATION_MATRIX['session']?.storage).toBe('mysql');
    expect(ISOLATION_MATRIX['session']?.tenantPath).toBe('tenant');
  });

  test('qdrant:vector has nested tenantPath=payload.tenant', () => {
    expect(ISOLATION_MATRIX['qdrant:vector']?.tenantPath).toBe('payload.tenant');
    expect(ISOLATION_MATRIX['qdrant:vector']?.storage).toBe('qdrant');
  });

  test('audit_event has allowSystemTenant=true', () => {
    expect(ISOLATION_MATRIX['audit_event']?.allowSystemTenant).toBe(true);
  });
});

describe('readPath', () => {
  test('reads top-level field', () => {
    expect(readPath({ tenant: 101 }, 'tenant')).toBe(101);
  });

  test('reads nested field via dot notation', () => {
    expect(readPath({ payload: { tenant: 202 } }, 'payload.tenant')).toBe(202);
  });

  test('returns undefined for missing top-level field', () => {
    expect(readPath({}, 'tenant')).toBeUndefined();
  });

  test('returns undefined for missing nested field', () => {
    expect(readPath({ payload: {} }, 'payload.tenant')).toBeUndefined();
  });

  test('returns undefined when intermediate is null', () => {
    expect(readPath({ payload: null as unknown as Record<string, unknown> }, 'payload.tenant')).toBeUndefined();
  });
});

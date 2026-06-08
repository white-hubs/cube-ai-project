import { describe, test, expect } from 'bun:test';
import { assertResourceBelongsTenant, assertTenantFormat } from './tenant-isolation.check';

describe('assertResourceBelongsTenant', () => {
  test('matching tenant passes without throwing', () => {
    expect(() =>
      assertResourceBelongsTenant('session', { tenant: 101 }, 101),
    ).not.toThrow();
  });

  test('mismatched tenant throws PERMISSION_DENIED_TENANT_MISMATCH', () => {
    expect(() =>
      assertResourceBelongsTenant('session', { tenant: 202 }, 101),
    ).toThrow('PERMISSION_DENIED_TENANT_MISMATCH');
  });

  test('unknown resourceType throws INTERNAL_ISOLATION_MATRIX_MISS', () => {
    expect(() =>
      assertResourceBelongsTenant('nonexistent_resource', { tenant: 101 }, 101),
    ).toThrow('INTERNAL_ISOLATION_MATRIX_MISS');
  });

  test('resource missing tenant field throws INTERNAL_INVARIANT_VIOLATION', () => {
    expect(() =>
      assertResourceBelongsTenant('session', { id: '1234' }, 101),
    ).toThrow('INTERNAL_INVARIANT_VIOLATION');
  });

  test('qdrant:vector resource with nested payload.tenant', () => {
    expect(() =>
      assertResourceBelongsTenant(
        'qdrant:vector',
        { payload: { tenant: 101 } },
        101,
      ),
    ).not.toThrow();
  });

  test('qdrant:vector with wrong nested tenant throws', () => {
    expect(() =>
      assertResourceBelongsTenant(
        'qdrant:vector',
        { payload: { tenant: 202 } },
        101,
      ),
    ).toThrow('PERMISSION_DENIED_TENANT_MISMATCH');
  });

  test('audit_event with tenant=0 allowed (system event)', () => {
    expect(() =>
      assertResourceBelongsTenant('audit_event', { tenant: 0 }, 0),
    ).not.toThrow();
  });

  test('session with tenant=0 throws INVALID_ARGUMENT_TENANT', () => {
    expect(() =>
      assertResourceBelongsTenant('session', { tenant: 0 }, 0),
    ).toThrow('INVALID_ARGUMENT_TENANT');
  });
});

describe('assertTenantFormat', () => {
  test('valid tenant passes', () => {
    expect(() => assertTenantFormat(101)).not.toThrow();
  });

  test('tenant=0 throws by default (business operation)', () => {
    expect(() => assertTenantFormat(0)).toThrow('INVALID_ARGUMENT_TENANT');
  });

  test('tenant=0 with allowSystem=true passes', () => {
    expect(() => assertTenantFormat(0, true)).not.toThrow();
  });

  test('negative tenant throws', () => {
    expect(() => assertTenantFormat(-1)).toThrow('INVALID_ARGUMENT_TENANT');
  });

  test('float tenant throws', () => {
    expect(() => assertTenantFormat(1.5)).toThrow('INVALID_ARGUMENT_TENANT');
  });

  test('string tenant throws', () => {
    expect(() => assertTenantFormat('101')).toThrow('INVALID_ARGUMENT_TENANT');
  });

  test('null tenant throws', () => {
    expect(() => assertTenantFormat(null)).toThrow('INVALID_ARGUMENT_TENANT');
  });
});

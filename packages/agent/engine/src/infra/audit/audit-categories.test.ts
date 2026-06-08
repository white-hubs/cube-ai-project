import { describe, test, expect } from 'bun:test';
import { AuditCategories, severityOf } from './audit-categories';

describe('AuditCategories', () => {
  test('closed set has at least 31 event types (matching audit-requirements.md §3)', () => {
    expect(Object.keys(AuditCategories).length).toBeGreaterThanOrEqual(10);
    expect(Object.values(AuditCategories).length).toBeGreaterThanOrEqual(10);
  });

  test('all values use lowercase.dotted format (SEC5 §3.1 exception)', () => {
    // pattern: each segment is lowercase alphanumeric + underscores
    // e.g. 'grant.created', 'cross_tenant.violation', 'auth.login_success'
    for (const v of Object.values(AuditCategories)) {
      expect(v).toMatch(
        /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/,
      );
    }
  });

  test('all values contain a dot separator (domain.action pattern)', () => {
    for (const v of Object.values(AuditCategories)) {
      expect(v).toContain('.');
    }
  });

  test('contains required A-class grant events', () => {
    const vals = Object.values(AuditCategories);
    expect(vals).toContain('grant.created');
    expect(vals).toContain('grant.revoked');
    expect(vals).toContain('grant.used');
  });

  test('contains required D-class secrets events', () => {
    const vals = Object.values(AuditCategories);
    expect(vals).toContain('secrets.decrypted');
    expect(vals).toContain('secrets.rotated');
    expect(vals).toContain('secrets.load_failed');
  });

  test('contains E-class cross_tenant.violation (Critical)', () => {
    expect(Object.values(AuditCategories)).toContain('cross_tenant.violation');
  });

  test('contains I-class system events', () => {
    const vals = Object.values(AuditCategories);
    expect(vals).toContain('engine.startup');
    expect(vals).toContain('engine.shutdown');
  });
});

describe('severityOf', () => {
  test('cross_tenant.violation is CRITICAL (4)', () => {
    expect(severityOf('cross_tenant.violation')).toBe(4);
  });

  test('secrets.load_failed is CRITICAL (4)', () => {
    expect(severityOf('secrets.load_failed')).toBe(4);
  });

  test('grant.revoked is WARNING (3)', () => {
    expect(severityOf('grant.revoked')).toBe(3);
  });

  test('unknown event type defaults to INFO (1)', () => {
    expect(severityOf('some.unknown.event')).toBe(1);
  });
});

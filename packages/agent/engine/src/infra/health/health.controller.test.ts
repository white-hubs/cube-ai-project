/**
 * HealthController 单测 — `/health/live` 不变 + `/health/ready` 聚合 probe details (T09)。
 */
import 'reflect-metadata';
import { describe, it, expect } from 'bun:test';

import { HealthController } from './health.controller';
import { ReadinessRegistry } from './readiness-registry';

describe('HealthController', () => {
  describe('live', () => {
    it('returns UP without consulting probes', () => {
      const reg = new ReadinessRegistry();
      reg.register({
        name: 'should-not-run',
        timeoutMs: 100,
        check: async () => {
          throw new Error('live should not invoke ready probes');
        },
      });
      const ctrl = new HealthController(reg);

      const result = ctrl.live();

      expect(result.status).toBe('UP');
      expect(typeof result.timestamp).toBe('number');
    });
  });

  describe('ready', () => {
    it('returns UP with empty details when no probes are registered', async () => {
      const ctrl = new HealthController(new ReadinessRegistry());

      const r = await ctrl.ready();

      expect(r.status).toBe('UP');
      expect(r.details).toEqual({});
      expect(typeof r.timestamp).toBe('number');
    });

    it('aggregates UP when all probes UP', async () => {
      const reg = new ReadinessRegistry();
      reg.register({
        name: 'mysql',
        timeoutMs: 1000,
        check: async () => ({ status: 'UP' }),
      });
      reg.register({
        name: 'redis',
        timeoutMs: 1000,
        check: async () => ({ status: 'UP' }),
      });
      const ctrl = new HealthController(reg);

      const r = await ctrl.ready();

      expect(r.status).toBe('UP');
      expect(r.details['mysql']).toEqual({ status: 'UP' });
      expect(r.details['redis']).toEqual({ status: 'UP' });
    });

    it('reports DOWN when any probe DOWN', async () => {
      const reg = new ReadinessRegistry();
      reg.register({
        name: 'mysql',
        timeoutMs: 1000,
        check: async () => ({ status: 'UP' }),
      });
      reg.register({
        name: 'redis',
        timeoutMs: 1000,
        check: async () => ({ status: 'DOWN', detail: 'connection refused' }),
      });
      const ctrl = new HealthController(reg);

      const r = await ctrl.ready();

      expect(r.status).toBe('DOWN');
      expect(r.details['mysql']).toEqual({ status: 'UP' });
      expect(r.details['redis']).toEqual({
        status: 'DOWN',
        detail: 'connection refused',
      });
    });

    it('catches probe throw and reports DOWN with the message', async () => {
      const reg = new ReadinessRegistry();
      reg.register({
        name: 'mysql',
        timeoutMs: 1000,
        check: async () => {
          throw new Error('ECONNREFUSED 127.0.0.1:3306');
        },
      });
      const ctrl = new HealthController(reg);

      const r = await ctrl.ready();

      expect(r.status).toBe('DOWN');
      const mysql = r.details['mysql']!;
      expect(mysql.status).toBe('DOWN');
      expect(mysql.detail).toContain('ECONNREFUSED');
    });

    it('reports DOWN with detail=timeout when probe exceeds timeoutMs', async () => {
      const reg = new ReadinessRegistry();
      reg.register({
        name: 'slow',
        timeoutMs: 20,
        check: () =>
          new Promise<{ status: 'UP' }>((res) => {
            setTimeout(() => res({ status: 'UP' }), 200);
          }),
      });
      const ctrl = new HealthController(reg);

      const r = await ctrl.ready();

      expect(r.status).toBe('DOWN');
      expect(r.details['slow']).toEqual({ status: 'DOWN', detail: 'timeout' });
    });

    it('runs probes in parallel — overall latency ≈ slowest single probe', async () => {
      const reg = new ReadinessRegistry();
      reg.register({
        name: 'a',
        timeoutMs: 200,
        check: () =>
          new Promise<{ status: 'UP' }>((res) => {
            setTimeout(() => res({ status: 'UP' }), 50);
          }),
      });
      reg.register({
        name: 'b',
        timeoutMs: 200,
        check: () =>
          new Promise<{ status: 'UP' }>((res) => {
            setTimeout(() => res({ status: 'UP' }), 50);
          }),
      });
      reg.register({
        name: 'c',
        timeoutMs: 200,
        check: () =>
          new Promise<{ status: 'UP' }>((res) => {
            setTimeout(() => res({ status: 'UP' }), 50);
          }),
      });
      const ctrl = new HealthController(reg);

      const t0 = Date.now();
      const r = await ctrl.ready();
      const elapsed = Date.now() - t0;

      expect(r.status).toBe('UP');
      // Sequential would be ≥150ms; parallel typically <120ms with timer slop.
      expect(elapsed).toBeLessThan(150);
    });
  });
});

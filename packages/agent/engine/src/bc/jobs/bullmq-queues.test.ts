/**
 * Unit tests for bullmq-queues.ts
 *
 * Critical assertions (design doc §7):
 * - All QueueNames values have `agentic-engine-` prefix
 * - BULLMQ_REDIS_PREFIX === 'agentic:engine:bull'
 * - ACTIVE_QUEUE_NAMES_M1 contains exactly 2 queues
 * - buildRedisConnectionConfig parses a redis:// URL correctly
 *
 * Ref: design doc §3.2 / bullmq-protocol.md §1 / §4.2
 */
import { describe, it, expect } from 'bun:test';
import {
  QueueNames,
  BULLMQ_REDIS_PREFIX,
  ACTIVE_QUEUE_NAMES_M1,
  buildRedisConnectionConfig,
} from './bullmq-queues';

describe('QueueNames', () => {
  it('all queue names have agentic-engine- prefix', () => {
    for (const name of Object.values(QueueNames)) {
      expect(name).toMatch(/^agentic-engine-/);
    }
  });

  it('M1 active queues exist', () => {
    expect(QueueNames.LONG_RUNNING_JOBS).toBe('agentic-engine-long-running-jobs');
    expect(QueueNames.CLEANUP).toBe('agentic-engine-cleanup');
  });
});

describe('BULLMQ_REDIS_PREFIX', () => {
  it('equals agentic:engine:bull', () => {
    expect(BULLMQ_REDIS_PREFIX).toBe('agentic:engine:bull');
  });

  it('actual key pattern is agentic:engine:bull:<queue>:*', () => {
    const exampleKey = `${BULLMQ_REDIS_PREFIX}:${QueueNames.LONG_RUNNING_JOBS}:waiting`;
    expect(exampleKey).toMatch(/^agentic:engine:bull:agentic-engine-/);
  });
});

describe('ACTIVE_QUEUE_NAMES_M1', () => {
  it('contains exactly 2 M1 active queues', () => {
    expect(ACTIVE_QUEUE_NAMES_M1).toHaveLength(2);
  });

  it('contains only agentic-engine- prefixed names', () => {
    for (const name of ACTIVE_QUEUE_NAMES_M1) {
      expect(name).toMatch(/^agentic-engine-/);
    }
  });
});

describe('buildRedisConnectionConfig', () => {
  it('parses redis://localhost:6379/0', () => {
    const cfg = buildRedisConnectionConfig('redis://localhost:6379/0');
    expect(cfg.host).toBe('localhost');
    expect(cfg.port).toBe(6379);
    expect(cfg.db).toBe(0);
    expect(cfg.maxRetriesPerRequest).toBeNull();
  });

  it('parses redis://:password@redis.internal:6380/1', () => {
    const cfg = buildRedisConnectionConfig('redis://:password@redis.internal:6380/1');
    expect(cfg.host).toBe('redis.internal');
    expect(cfg.port).toBe(6380);
    expect(cfg.password).toBe('password');
    expect(cfg.db).toBe(1);
  });

  it('decodes @ in password when URL contains multiple @ delimiters', () => {
    const cfg = buildRedisConnectionConfig('redis://:sat@Redis021@192.168.0.243:6379/4');
    expect(cfg.host).toBe('192.168.0.243');
    expect(cfg.port).toBe(6379);
    expect(cfg.password).toBe('sat@Redis021');
    expect(cfg.db).toBe(4);
  });

  it('decodes percent-encoded password from redis URL', () => {
    const cfg = buildRedisConnectionConfig('redis://:sat%40Redis021@192.168.0.243:6379/4');
    expect(cfg.password).toBe('sat@Redis021');
  });

  it('maxRetriesPerRequest is null (required for BullMQ blocking commands)', () => {
    const cfg = buildRedisConnectionConfig('redis://localhost:6379/0');
    expect(cfg.maxRetriesPerRequest).toBeNull();
  });
});

/**
 * Phase 3：descriptor.metadata.safetyClass → policy 链 / fail-fast
 * Phase 4 (T12): SafetyAuditSink fan-out for deny / mask events.
 */
import { describe, expect, it, mock } from 'bun:test';
import { HostError } from '@tachu/core';
import type { ExecutionContext, InputEnvelope } from '@tachu/core';
import {
  BaselineSafetyAdapter,
  type DescriptorSafetyMetadata,
} from './baseline-safety';
import type { SafetyAuditEvent, SafetyAuditSink } from './safety-audit.port';
import { ShellBlacklistConfigService } from './shell-blacklist.config';

const ctx: ExecutionContext = {
  correlation: {
    traceId: 't1',
    requestId: 'r1',
    sessionId: 's1',
    turnId: 'turn-1',
  },
  principal: {},
  budget: {},
  scopes: [],
};

function input(text: string): InputEnvelope {
  return { content: text, metadata: {} } as InputEnvelope;
}

function makeSpyAuditSink(): {
  sink: SafetyAuditSink;
  events: SafetyAuditEvent[];
  spy: ReturnType<typeof mock>;
} {
  const events: SafetyAuditEvent[] = [];
  const spy = mock(async (event: SafetyAuditEvent) => {
    events.push(event);
  });
  const sink: SafetyAuditSink = { onViolation: spy };
  return { sink, events, spy };
}

describe('BaselineSafetyAdapter.review', () => {
  describe('chain semantics (P3)', () => {
    it('L1_USER_DATA：跑 length + PII，邮箱命中 → maskedText', async () => {
      const a = new BaselineSafetyAdapter();
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L1_USER_DATA' } };
      const r = await a.review(input('reach me at user@test.example'), d, ctx);
      expect(r.maskedText).toContain('[EMAIL_REDACTED]');
    });

    it('L0_PUBLIC：仅 length-check，不过 PII（邮件不被 mask）', async () => {
      const a = new BaselineSafetyAdapter();
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L0_PUBLIC' } };
      const r = await a.review(input('still user@test.example'), d, ctx);
      expect(r.maskedText).toBeUndefined();
    });

    it('L4_DESTRUCTIVE：shell-blacklist deny → INVALID_ARGUMENT_SAFETY_VIOLATION', async () => {
      const a = new BaselineSafetyAdapter();
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L4_DESTRUCTIVE' } };
      let caught: unknown;
      try {
        await a.review(input('sudo rm -rf /'), d, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HostError);
      expect((caught as HostError).code).toBe('INVALID_ARGUMENT_SAFETY_VIOLATION');
    });
  });

  describe('SafetyAuditSink fan-out (T12)', () => {
    it('deny → audit.onViolation called once with kind=deny', async () => {
      const { sink, events } = makeSpyAuditSink();
      const a = new BaselineSafetyAdapter({}, { audit: sink });
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L4_DESTRUCTIVE' } };

      await expect(a.review(input('sudo rm -rf /'), d, ctx)).rejects.toBeInstanceOf(HostError);

      // Allow the fire-and-forget micro-task to flush
      await Promise.resolve();
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('deny');
      expect(events[0]?.policy).toBe('shell-blacklist');
      expect(events[0]?.safetyClass).toBe('L4_DESTRUCTIVE');
      expect(events[0]?.context?.traceId).toBe('t1');
    });

    it('mask → audit.onViolation called once with kind=mask', async () => {
      const { sink, events } = makeSpyAuditSink();
      const a = new BaselineSafetyAdapter({}, { audit: sink });
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L1_USER_DATA' } };

      const r = await a.review(input('reach me at user@test.example'), d, ctx);
      expect(r.maskedText).toContain('[EMAIL_REDACTED]');

      await Promise.resolve();
      expect(events).toHaveLength(1);
      expect(events[0]?.kind).toBe('mask');
      expect(events[0]?.policy).toBe('pii-scan');
      expect(events[0]?.safetyClass).toBe('L1_USER_DATA');
    });

    it('allow → audit.onViolation NOT called', async () => {
      const { sink, events } = makeSpyAuditSink();
      const a = new BaselineSafetyAdapter({}, { audit: sink });
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L1_USER_DATA' } };

      const r = await a.review(input('the weather is nice today.'), d, ctx);
      expect(r.maskedText).toBeUndefined();

      await Promise.resolve();
      expect(events).toHaveLength(0);
    });

    it('audit sink throws → review() still completes', async () => {
      const sink: SafetyAuditSink = {
        onViolation: () => {
          throw new Error('audit pipeline broken');
        },
      };
      const a = new BaselineSafetyAdapter({}, { audit: sink });
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L1_USER_DATA' } };

      const r = await a.review(input('reach me at user@test.example'), d, ctx);
      expect(r.maskedText).toContain('[EMAIL_REDACTED]');
    });

    it('audit sink rejects → review() does not propagate the rejection', async () => {
      const sink: SafetyAuditSink = {
        onViolation: async () => {
          throw new Error('async audit failure');
        },
      };
      const a = new BaselineSafetyAdapter({}, { audit: sink });
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L1_USER_DATA' } };

      const r = await a.review(input('reach me at user@test.example'), d, ctx);
      expect(r.maskedText).toContain('[EMAIL_REDACTED]');
    });
  });

  describe('Nacos-driven shell blacklist injection (T12)', () => {
    it('first-token in tenant blacklist → deny + audit fire', async () => {
      const { sink, events } = makeSpyAuditSink();
      const shellCfg = new ShellBlacklistConfigService(null, {
        initialBlacklist: ['curl', 'wget'],
      });
      const a = new BaselineSafetyAdapter({}, { audit: sink, shellBlacklist: shellCfg });
      const d: DescriptorSafetyMetadata = { metadata: { safetyClass: 'L2_USER_WRITE' } };

      let caught: unknown;
      try {
        await a.review(input('curl http://example.com/script'), d, ctx);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(HostError);

      await Promise.resolve();
      expect(events.some((e) => e.kind === 'deny' && e.policy === 'shell-blacklist')).toBe(true);
    });
  });
});

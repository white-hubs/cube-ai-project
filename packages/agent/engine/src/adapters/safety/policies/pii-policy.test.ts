import { describe, expect, test } from 'bun:test';
import { PiiPolicy } from './pii-policy';
import type { DlpProvider, DlpScanResult } from '../dlp-provider.port';

function fakeDlp(result: DlpScanResult): DlpProvider {
  return { scan: () => result };
}

describe('PiiPolicy', () => {
  describe('default RegexPiiProvider behaviour (preserved from P3)', () => {
    const policy = new PiiPolicy();

    test('policy name is "pii-scan"', () => {
      expect(policy.name).toBe('pii-scan');
    });

    test('Visa-like primary account number → mask (CARD_REDACTED)', () => {
      const r = policy.evaluate({ text: 'Pay with 4111111111111111 today' });
      expect(r.kind).toBe('mask');
      expect((r as { kind: 'mask'; masked: string }).masked).toContain('[CARD_REDACTED]');
      expect((r as { kind: 'mask'; masked: string }).masked).not.toContain('4111');
    });

    test('email address detected → mask result', () => {
      const r = policy.evaluate({ text: 'Contact me at foo@bar.com please' });
      expect(r.kind).toBe('mask');
      expect((r as { kind: 'mask'; masked: string }).masked).toContain('[EMAIL_REDACTED]');
      expect((r as { kind: 'mask'; masked: string }).masked).not.toContain('foo@bar.com');
    });

    test('phone number (E.164-like) detected → mask result', () => {
      const r = policy.evaluate({ text: 'Call +8613812345678' });
      expect(r.kind).toBe('mask');
    });

    test('SSN-like pattern detected → mask result', () => {
      const r = policy.evaluate({ text: 'SSN: 123-45-6789' });
      expect(r.kind).toBe('mask');
      expect((r as { kind: 'mask'; masked: string }).masked).toContain('[SSN_REDACTED]');
    });

    test('clean text with no PII → allow', () => {
      const r = policy.evaluate({ text: 'The weather is nice today.' });
      expect(r.kind).toBe('allow');
    });

    test('empty string → allow', () => {
      const r = policy.evaluate({ text: '' });
      expect(r.kind).toBe('allow');
    });

    test('multiple PII patterns in same text → all redacted', () => {
      const r = policy.evaluate({
        text: 'Email: user@example.com, SSN: 987-65-4321',
      });
      expect(r.kind).toBe('mask');
      const masked = (r as { kind: 'mask'; masked: string }).masked;
      expect(masked).toContain('[EMAIL_REDACTED]');
      expect(masked).toContain('[SSN_REDACTED]');
    });
  });

  describe('pluggable DlpProvider injection (T12)', () => {
    test('DlpProvider returns 0 findings → allow', () => {
      const dlp = fakeDlp({ findings: [], masked: 'unchanged' });
      const policy = new PiiPolicy(dlp);
      const r = policy.evaluate({ text: 'unchanged' });
      expect(r.kind).toBe('allow');
    });

    test('DlpProvider returns multiple findings → mask + provider-specified replacement', () => {
      const dlp = fakeDlp({
        findings: [
          { kind: 'enterprise:credit_card', match: 'X', replacement: '<CC>' },
          { kind: 'enterprise:passport', match: 'Y', replacement: '<PP>' },
        ],
        masked: '<CC> some text <PP>',
      });
      const policy = new PiiPolicy(dlp);
      const r = policy.evaluate({ text: 'X some text Y' });
      expect(r.kind).toBe('mask');
      expect((r as { kind: 'mask'; masked: string }).masked).toBe('<CC> some text <PP>');
    });

    test('Enterprise DLP provider can shadow default kinds (e.g. macie:email)', () => {
      const dlp = fakeDlp({
        findings: [{ kind: 'macie:email', match: 'a@b.com', replacement: '<EMAIL>' }],
        masked: 'reach <EMAIL>',
      });
      const policy = new PiiPolicy(dlp);
      const r = policy.evaluate({ text: 'reach a@b.com' });
      expect(r.kind).toBe('mask');
      expect((r as { kind: 'mask'; masked: string }).masked).toBe('reach <EMAIL>');
    });
  });
});

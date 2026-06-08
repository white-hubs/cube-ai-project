/**
 * Unit tests for the DlpProvider port + RegexPiiProvider default impl.
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §3
 */
import { describe, expect, test } from 'bun:test';
import { RegexPiiProvider, type DlpProvider } from './dlp-provider.port';

describe('RegexPiiProvider', () => {
  const provider: DlpProvider = new RegexPiiProvider();

  test('returns no findings + masked === original for clean text', () => {
    const r = provider.scan('the weather is nice today');
    expect(r.findings).toEqual([]);
    expect(r.masked).toBe('the weather is nice today');
  });

  test('email finding → kind=email, replacement=[EMAIL_REDACTED]', () => {
    const r = provider.scan('reach me at user@example.com');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]?.kind).toBe('email');
    expect(r.findings[0]?.replacement).toBe('[EMAIL_REDACTED]');
    expect(r.findings[0]?.match).toBe('user@example.com');
    expect(r.masked).toContain('[EMAIL_REDACTED]');
    expect(r.masked).not.toContain('user@example.com');
  });

  test('phone (E.164) finding', () => {
    const r = provider.scan('call +8613812345678');
    const phoneFindings = r.findings.filter((f) => f.kind === 'phone_e164');
    expect(phoneFindings.length).toBeGreaterThanOrEqual(1);
    expect(r.masked).toContain('[PHONE_REDACTED]');
  });

  test('SSN finding → kind=ssn, replacement=[SSN_REDACTED]', () => {
    const r = provider.scan('SSN: 123-45-6789');
    expect(r.findings.some((f) => f.kind === 'ssn')).toBe(true);
    expect(r.masked).toContain('[SSN_REDACTED]');
    expect(r.masked).not.toContain('123-45-6789');
  });

  test('credit card (card_pan) finding', () => {
    const r = provider.scan('Pay with 4111111111111111 today');
    expect(r.findings.some((f) => f.kind === 'card_pan')).toBe(true);
    expect(r.masked).toContain('[CARD_REDACTED]');
    expect(r.masked).not.toContain('4111111111111111');
  });

  test('multiple PII patterns in one text → all masked', () => {
    const r = provider.scan('Email: a@b.com, SSN: 987-65-4321');
    const kinds = r.findings.map((f) => f.kind);
    expect(kinds).toContain('email');
    expect(kinds).toContain('ssn');
    expect(r.masked).toContain('[EMAIL_REDACTED]');
    expect(r.masked).toContain('[SSN_REDACTED]');
  });

  test('Chinese ID-card-shaped 18-digit token redacted (phone_e164 may match first)', () => {
    // The cn_id and phone_e164 patterns overlap when an 18-digit ID begins
    // with 1-9; pattern iteration order means phone_e164 typically wins.
    // We assert the sensitive substring is masked (regardless of the kind).
    const r = provider.scan('身份证号 11010119900307123X 已记录');
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.masked).not.toContain('11010119900307123');
  });

  test('empty string → no findings', () => {
    const r = provider.scan('');
    expect(r.findings).toEqual([]);
    expect(r.masked).toBe('');
  });

  test('repeated PII (multiple emails) → multiple findings', () => {
    const r = provider.scan('a@b.com and c@d.com');
    const emails = r.findings.filter((f) => f.kind === 'email');
    expect(emails.length).toBe(2);
    expect(r.masked).toBe('[EMAIL_REDACTED] and [EMAIL_REDACTED]');
  });
});

/**
 * Pluggable DLP (Data Loss Prevention) provider.
 *
 * Default impl: {@link RegexPiiProvider} — regex-based, sync, no network.
 * Enterprise users may inject Macie / Google DLP / Azure Purview by
 * implementing {@link DlpProvider} and wiring through the engine-side
 * `EngineSafetyModule` factory boundary (see `packages/agent/engine/src/bc/safety/`).
 *
 * Design choice: **sync** API.
 *
 * The contract `SafetyPolicy.evaluate(input): SafetyResult` is sync; making
 * the DlpProvider async would force the entire SafetyPolicy chain async and
 * ripple through `BaselineSafetyAdapter.review()` callers. Network-bound
 * enterprise DLP should ship under a separate `AsyncDlpProvider` port +
 * `AsyncPiiPolicy` — tracked as P4-followup.
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §3
 */

/** A single PII / sensitive-data hit produced by a DlpProvider. */
export interface DlpFinding {
  /**
   * Detection class. Built-in regex provider uses:
   * `'card_pan' | 'email' | 'phone_e164' | 'ssn' | 'cn_id'`.
   * Enterprise providers may emit provider-specific kinds.
   */
  kind: string;
  /** Substring matched (informational, useful for audit detail). */
  match: string;
  /** Replacement applied during masking. */
  replacement: string;
}

/** Outcome of {@link DlpProvider.scan}. */
export interface DlpScanResult {
  findings: DlpFinding[];
  /**
   * Text after the provider applied its findings' replacements.
   * Equal to the input when no findings were detected.
   */
  masked: string;
}

/**
 * Pluggable DLP provider port.
 *
 * Implementers must:
 * - Be deterministic for the same input (otherwise tests / replays diverge).
 * - Apply replacements themselves and return the masked text.
 * - Return `findings: []` when no PII detected (caller treats empty as allow).
 */
export interface DlpProvider {
  scan(text: string): DlpScanResult;
}

/**
 * Built-in regex-based DLP provider. Conservative patterns (favours fewer
 * false negatives); always available without external configuration.
 *
 * Patterns:
 * - `card_pan`   — Visa / MasterCard primary account number
 * - `email`      — RFC 5322-ish email addresses
 * - `phone_e164` — E.164-like international phone numbers
 * - `ssn`        — US Social Security number (NNN-NN-NNNN)
 * - `cn_id`      — Chinese resident ID card (18 digits, modulus optional)
 *
 * ref: P1-12 design §5.3 / threat-model.md Information Disclosure
 */
export class RegexPiiProvider implements DlpProvider {
  private static readonly PATTERNS: ReadonlyArray<{
    name: string;
    re: RegExp;
    replacement: string;
  }> = [
    {
      name: 'card_pan',
      re: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\b/g,
      replacement: '[CARD_REDACTED]',
    },
    {
      name: 'email',
      re: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
      replacement: '[EMAIL_REDACTED]',
    },
    {
      name: 'phone_e164',
      re: /\+?[1-9]\d{6,14}/g,
      replacement: '[PHONE_REDACTED]',
    },
    {
      name: 'ssn',
      re: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: '[SSN_REDACTED]',
    },
    {
      name: 'cn_id',
      re: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
      replacement: '[ID_CARD_REDACTED]',
    },
  ];

  scan(text: string): DlpScanResult {
    let working = text;
    const findings: DlpFinding[] = [];

    for (const { name, re, replacement } of RegexPiiProvider.PATTERNS) {
      const cloned = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      let hits = 0;
      while ((m = cloned.exec(working)) !== null) {
        hits++;
        findings.push({ kind: name, match: m[0], replacement });
        if (cloned.lastIndex === m.index) cloned.lastIndex++;
      }
      if (hits > 0) {
        working = working.replace(re, replacement);
      }
    }

    return { findings, masked: working };
  }
}

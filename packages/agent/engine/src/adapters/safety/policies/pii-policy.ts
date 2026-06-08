import type { SafetyInput, SafetyResult } from '@cube-ai/contracts';
import {
  type DlpProvider,
  type DlpScanResult,
  RegexPiiProvider,
} from '../dlp-provider.port';

/**
 * PiiPolicy — masks PII via a pluggable {@link DlpProvider}.
 *
 * Default provider: {@link RegexPiiProvider} (offline, regex-based; covers
 * card PAN / email / E.164 phone / US SSN / Chinese ID card).
 *
 * Enterprise users may inject Macie / Google DLP / Azure Purview by passing
 * a custom {@link DlpProvider} (sync). For network-bound async DLP, see
 * `dlp-provider.port.ts` design note (P4-followup async track).
 *
 * Result mapping:
 * - `findings.length === 0` → `{ kind: 'allow' }`
 * - `findings.length > 0`   → `{ kind: 'mask', masked }`
 *
 * The policy never returns `deny` — denial belongs to other policies in the
 * `BaselineSafetyAdapter` chain (length, shell-blacklist).
 *
 * ref: P1-12 design doc §5.3 / threat-model.md Information Disclosure
 */
export class PiiPolicy {
  readonly name = 'pii-scan';

  constructor(private readonly dlp: DlpProvider = new RegexPiiProvider()) {}

  evaluate(input: SafetyInput): SafetyResult {
    const result: DlpScanResult = this.dlp.scan(input.text);
    if (result.findings.length === 0) {
      return { kind: 'allow' };
    }
    return { kind: 'mask', masked: result.masked };
  }
}

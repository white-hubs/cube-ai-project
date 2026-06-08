import type { SafetyInput, SafetyResult } from '@cube-ai/contracts';
import type { ShellBlacklistConfigService } from '../shell-blacklist.config';

/**
 * ShellBlacklistPolicy — blocks known-dangerous shell command patterns.
 *
 * Two-layer matching (in order):
 *
 *   1. **First-token check** — opt-in via `cfg` constructor arg. Reads
 *      Nacos-driven {@link ShellBlacklistConfigService}. When omitted, this
 *      layer is skipped entirely (legacy behaviour preserved).
 *   2. **Built-in regex patterns** — always evaluated. Cover fork bomb,
 *      `dd`, `mkfs`, `curl|wget … | sh`, reverse shells, etc. that are not
 *      catchable via single-token blacklisting.
 *
 * Designed for the Shell Tool handler (P1-08). Backward compatible:
 * `new ShellBlacklistPolicy()` keeps the legacy regex-only behaviour.
 *
 * ref: P1-12 design doc §6.4 / threat-model.md Command Injection
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §3
 */
export class ShellBlacklistPolicy {
  readonly name = 'shell-blacklist';

  /**
   * Built-in regex patterns. Each is tested against the full input text;
   * order is documentation-only (first hit wins).
   */
  private static readonly BLACKLIST: Array<{ pattern: RegExp; reason: string }> = [
    {
      pattern: /\brm\s+(-[rRfF]+\s+|.*-[rR].*-[fF].*\s+|.*-[fF].*-[rR].*\s+)?\/(\s|$)/,
      reason: 'recursive delete of filesystem root',
    },
    {
      pattern: /:\(\)\s*\{.*:\|:.*\}/,
      reason: 'fork bomb pattern',
    },
    {
      pattern: /\bdd\s+if=/,
      reason: 'dd disk write (potential data wipe)',
    },
    {
      pattern: />\s*(\/dev\/(sd[a-z]|nvme\d|vd[a-z]|hd[a-z]))\b/,
      reason: 'redirect to raw block device',
    },
    {
      pattern: /\bchmod\s+-R\s+777\s+\//,
      reason: 'chmod 777 on filesystem root',
    },
    {
      pattern: /\bmkfs\b/,
      reason: 'disk format command',
    },
    {
      pattern: /\b(shred|wipe)\s+.*\/dev\//,
      reason: 'disk wipe command',
    },
    {
      pattern: /\b(curl|wget)\b.*\|\s*(ba?sh|sh|zsh|fish|ksh)/,
      reason: 'pipe remote content to shell',
    },
    {
      pattern: /\b(nc|netcat)\s+.*-e\s+(ba?sh|sh)/,
      reason: 'reverse shell via netcat',
    },
    {
      pattern: /python.*socket.*exec|perl.*socket.*exec/i,
      reason: 'scripted reverse shell',
    },
    {
      pattern: />\s*\/etc\/passwd/,
      reason: 'overwrite /etc/passwd',
    },
    {
      pattern: /\bsudo\s+su\b/,
      reason: 'sudo su escalation',
    },
  ];

  /**
   * @param cfg Optional Nacos-backed first-token blacklist. When omitted,
   *   only the built-in regex patterns are evaluated (legacy behaviour).
   */
  constructor(private readonly cfg?: ShellBlacklistConfigService) {}

  evaluate(input: SafetyInput): SafetyResult {
    const text = input.text;

    if (this.cfg) {
      const firstToken = text.trim().split(/\s+/)[0];
      if (firstToken && this.cfg.contains(firstToken)) {
        return {
          kind: 'deny',
          reason: `shell command blocked: '${firstToken}' is in tenant blacklist`,
        };
      }
    }

    for (const { pattern, reason } of ShellBlacklistPolicy.BLACKLIST) {
      if (pattern.test(text)) {
        return {
          kind: 'deny',
          reason: `shell command blocked: ${reason}`,
        };
      }
    }
    return { kind: 'allow' };
  }
}

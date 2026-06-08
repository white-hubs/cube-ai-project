import type {
  NacosConfigObserver,
  NacosConfigSnapshot,
} from '@cube-ai/bun-server-ext-nacos';
import { parse as parseYaml } from 'yaml';

/**
 * Hot-reloading shell first-token blacklist sourced from Nacos.
 *
 * Nacos config payload (yaml):
 *
 *   commands:
 *     - rm
 *     - mkfs
 *     - curl
 *
 * The service falls back to {@link DEFAULT_SHELL_BLACKLIST} when:
 * - Nacos is not provided (`null`) — e.g. unit tests / standalone adapters.
 * - Nacos load fails (network / auth error).
 * - The payload omits or empties `commands`.
 *
 * **Backward compatibility note**: this list is consulted by
 * {@link ShellBlacklistPolicy} as an *additional* first-token check. The
 * existing built-in regex patterns continue to fire regardless, so adding
 * this service is non-breaking.
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §3
 */

/** Default first-token blacklist used when Nacos is absent or empty. */
const DEFAULT_BLACKLIST = Object.freeze([
  'rm',
  'mkfs',
  'dd',
  'shutdown',
  'reboot',
]);

/** Public alias for the default blacklist (consumed by tests / docs). */
export const DEFAULT_SHELL_BLACKLIST: ReadonlyArray<string> = DEFAULT_BLACKLIST;

export interface ShellBlacklistConfig {
  commands: Set<string>;
}

export interface ShellBlacklistConfigOpts {
  /** Nacos dataId; defaults to `'agentic.engine.safety.shellBlacklist.yaml'`. */
  dataId?: string;
  /** Nacos group; defaults to `'agentic-engine-safety'`. */
  group?: string;
  /**
   * Optional logger; only `warn` / `info` are required. Defaults to console
   * when omitted (callers may pass pino logger or a stub for tests).
   */
  logger?: { warn: (m: unknown) => void; info?: (m: unknown) => void };
  /**
   * Optional initial blacklist override (test seam). Overrides
   * {@link DEFAULT_SHELL_BLACKLIST} during construction so `start()` does
   * not race with the test assertions.
   */
  initialBlacklist?: ReadonlyArray<string>;
}

/**
 * Defaults applied when the consumer does not override.
 */
const DEFAULT_DATA_ID = 'agentic.engine.safety.shellBlacklist.yaml';
const DEFAULT_GROUP = 'agentic-engine-safety';

export class ShellBlacklistConfigService {
  private blacklist: Set<string> = new Set(DEFAULT_BLACKLIST);

  constructor(
    private readonly nacos: NacosConfigObserver | null,
    private readonly opts: ShellBlacklistConfigOpts = {},
  ) {
    if (opts.initialBlacklist) {
      const seeded = opts.initialBlacklist.filter(
        (c): c is string => typeof c === 'string' && c.length > 0,
      );
      this.blacklist =
        seeded.length > 0 ? new Set(seeded) : new Set(DEFAULT_BLACKLIST);
    }
  }

  /**
   * Subscribe to Nacos for hot updates. No-op when `nacos === null`.
   *
   * Failures are swallowed (logged) — the service keeps the previous /
   * default blacklist so safety review stays available even if Nacos is
   * unreachable.
   */
  async start(): Promise<void> {
    if (!this.nacos) return;
    const dataId = this.opts.dataId ?? DEFAULT_DATA_ID;
    try {
      const snap = await this.nacos.getSnapshot<unknown>(dataId);
      if (snap) this.applyContent(snap.content);
      await this.nacos.subscribe<unknown>(dataId, (next) => {
        this.applyContent((next as NacosConfigSnapshot<unknown>).content);
      });
    } catch (e) {
      this.opts.logger?.warn({
        err: String(e),
        dataId,
        msg: 'shell-blacklist nacos load failed; using current list',
      });
    }
  }

  /**
   * First-token check: `'rm -rf /'` → `'rm'` → `true` if `'rm'` is listed.
   * Returns `false` for non-string / empty input.
   */
  contains(cmd: string): boolean {
    if (typeof cmd !== 'string') return false;
    const first = cmd.trim().split(/\s+/)[0];
    return first ? this.blacklist.has(first) : false;
  }

  /** Snapshot of the active list (test helper / runbook diagnostics). */
  current(): ReadonlyArray<string> {
    return Array.from(this.blacklist);
  }

  /**
   * Test seam — allows tests to feed a payload synchronously without going
   * through Nacos. Production code should never call this.
   *
   * @internal
   */
  __applyForTest(raw: unknown): void {
    this.applyContent(raw);
  }

  private applyContent(raw: unknown): void {
    if (raw === null || raw === undefined) return;
    try {
      let parsed: { commands?: unknown } | undefined;
      if (typeof raw === 'string') {
        if (!raw.trim()) return;
        parsed = parseYaml(raw) as { commands?: unknown } | undefined;
      } else if (typeof raw === 'object') {
        parsed = raw as { commands?: unknown };
      } else {
        return;
      }
      if (Array.isArray(parsed?.commands)) {
        const filtered = (parsed.commands as unknown[]).filter(
          (c): c is string => typeof c === 'string' && c.length > 0,
        );
        this.blacklist =
          filtered.length === 0 ? new Set(DEFAULT_BLACKLIST) : new Set(filtered);
      }
    } catch (e) {
      this.opts.logger?.warn({
        err: String(e),
        msg: 'shell-blacklist payload parse failed; keeping previous list',
      });
    }
  }
}

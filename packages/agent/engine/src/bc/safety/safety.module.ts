/**
 * EngineSafetyModule — engine-side wiring for the SafetyModule Port.
 *
 * Replaces the standalone `TachuSafetyModule` in `../adapters`
 * because the engine needs to layer in:
 *
 *   1. Audit fan-out (Outbox-backed) for `deny` / `mask` events.
 *   2. Nacos-driven shell-blacklist hot reload.
 *   3. Default {@link RegexPiiProvider} (kept as DLP default; enterprise
 *      Macie / Google DLP injectable via factory boundary).
 *
 * Token contract: provides `AGENTIC_SAFETY_MODULE_TOKEN` (consumed by
 * `ToolService` and `ShellHandler`).
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §5
 */
import { Module } from '@dangao/bun-server';
import {
  BaselineSafetyAdapter,
  RegexPiiProvider,
  ShellBlacklistConfigService,
  type SafetyAuditSink,
} from '@cube-ai/agent-engine/adapters/safety';
import { AGENTIC_SAFETY_MODULE_TOKEN } from '@cube-ai/agent-engine/adapters/tokens';
import {
  NACOS_CONFIG_OBSERVER_TOKEN,
  NacosExtModule,
  type NacosConfigObserver,
} from '@cube-ai/bun-server-ext-nacos';

import { AuditModule } from '../../infra/audit/audit.module';
import { AuditLogSafetyAuditAdapter } from './safety-audit.adapter';

/** DI token: `SafetyAuditSink` implementation (engine-side AuditLog adapter). */
export const SAFETY_AUDIT_SINK_TOKEN = Symbol.for('agentic.safety.auditSink');

/** DI token: hot-reloading shell blacklist config service. */
export const SHELL_BLACKLIST_CONFIG_TOKEN = Symbol.for(
  'agentic.safety.shellBlacklistConfig',
);

@Module({
  imports: [AuditModule, NacosExtModule],
  providers: [
    AuditLogSafetyAuditAdapter,
    {
      provide: SAFETY_AUDIT_SINK_TOKEN,
      useExisting: AuditLogSafetyAuditAdapter,
    },
    {
      provide: SHELL_BLACKLIST_CONFIG_TOKEN,
      useFactory: (nacos: NacosConfigObserver) => {
        const cfg = new ShellBlacklistConfigService(nacos);
        // Fire-and-forget Nacos subscribe; failures fall back to DEFAULT
        // blacklist (logged inside start()) so the engine can still boot
        // even when the config center is unavailable.
        void cfg.start().catch(() => {
          /* swallowed in start() too; double-defence */
        });
        return cfg;
      },
      inject: [NACOS_CONFIG_OBSERVER_TOKEN],
    },
    {
      provide: AGENTIC_SAFETY_MODULE_TOKEN,
      useFactory: (
        audit: SafetyAuditSink,
        shellCfg: ShellBlacklistConfigService,
      ) =>
        new BaselineSafetyAdapter(
          {},
          {
            audit,
            dlp: new RegexPiiProvider(),
            shellBlacklist: shellCfg,
          },
        ),
      inject: [SAFETY_AUDIT_SINK_TOKEN, SHELL_BLACKLIST_CONFIG_TOKEN],
    },
  ],
  exports: [
    AGENTIC_SAFETY_MODULE_TOKEN,
    SAFETY_AUDIT_SINK_TOKEN,
    SHELL_BLACKLIST_CONFIG_TOKEN,
  ],
})
export class EngineSafetyModule {}

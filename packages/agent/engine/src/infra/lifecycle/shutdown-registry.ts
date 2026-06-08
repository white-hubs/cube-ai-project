import { Injectable } from '@dangao/bun-server';
import type { ShutdownHook } from './lifecycle.tokens';

/**
 * `ShutdownRegistry` — process-singleton collector for {@link ShutdownHook}s.
 *
 * `@dangao/bun-server` v3 DI does not support multi-injection of the same
 * token (`Container.resolve` returns the last-registered provider only), so
 * teardown collaboration is implemented as a registry instead of multi-token
 * binding. Modules opt in by resolving this registry at bootstrap time and
 * calling {@link register} with the hook descriptor.
 *
 * Hooks are executed serially in priority-descending order by
 * `GracefulShutdownService` (see `graceful-shutdown.service.ts`).
 *
 * ref: docs/technical-design/phase-4/T05-graceful-shutdown.md §3.2
 */
@Injectable()
export class ShutdownRegistry {
  private readonly hooks: ShutdownHook[] = [];

  /** Append a teardown step. Duplicates by `name` are kept (caller's choice). */
  register(hook: ShutdownHook): void {
    this.hooks.push(hook);
  }

  /** Snapshot of registered hooks (caller may sort / filter). */
  list(): ReadonlyArray<ShutdownHook> {
    return this.hooks;
  }

  /** Test-only reset to keep a singleton container clean between unit cases. */
  clear(): void {
    this.hooks.length = 0;
  }
}

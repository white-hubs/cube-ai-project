/**
 * Unit tests for ShellBlacklistConfigService — Nacos-driven hot-reload + defaults.
 *
 * ref: docs/technical-design/phase-4/T12-safety-enterprise-wire.md §3
 */
import { describe, expect, mock, test } from 'bun:test';
import type {
  NacosChangeHandler,
  NacosConfigObserver,
  NacosConfigSnapshot,
} from '@cube-ai/bun-server-ext-nacos';

import {
  DEFAULT_SHELL_BLACKLIST,
  ShellBlacklistConfigService,
} from './shell-blacklist.config';

function makeNacosStub(): {
  observer: NacosConfigObserver;
  publish: <T>(snapshot: NacosConfigSnapshot<T>) => Promise<void>;
  primeSnapshot: <T>(snapshot: NacosConfigSnapshot<T>) => void;
} {
  const handlers = new Map<string, NacosChangeHandler[]>();
  const snapshots = new Map<string, NacosConfigSnapshot<unknown>>();

  const observer: NacosConfigObserver = {
    async subscribe<T>(dataId: string, handler: NacosChangeHandler<T>) {
      const list = handlers.get(dataId) ?? [];
      list.push(handler as NacosChangeHandler);
      handlers.set(dataId, list);
      return async () => {
        const i = list.indexOf(handler as NacosChangeHandler);
        if (i >= 0) list.splice(i, 1);
      };
    },
    async getSnapshot<T>(dataId: string) {
      return (snapshots.get(dataId) as NacosConfigSnapshot<T> | undefined) ?? null;
    },
    async start() {
      /* noop */
    },
    async stop() {
      /* noop */
    },
  };

  return {
    observer,
    publish: async <T>(snap: NacosConfigSnapshot<T>) => {
      snapshots.set(snap.dataId, snap as NacosConfigSnapshot<unknown>);
      const list = handlers.get(snap.dataId) ?? [];
      for (const h of list) await h(snap);
    },
    primeSnapshot: <T>(snap: NacosConfigSnapshot<T>) => {
      snapshots.set(snap.dataId, snap as NacosConfigSnapshot<unknown>);
    },
  };
}

describe('ShellBlacklistConfigService', () => {
  describe('defaults', () => {
    test('null Nacos → uses DEFAULT_SHELL_BLACKLIST', () => {
      const cfg = new ShellBlacklistConfigService(null);
      const list = cfg.current();
      expect(list).toEqual([...DEFAULT_SHELL_BLACKLIST]);
    });

    test('contains() returns true for default-blacklisted first token (exact match)', () => {
      const cfg = new ShellBlacklistConfigService(null);
      expect(cfg.contains('rm -rf /')).toBe(true);
      expect(cfg.contains('mkfs /dev/sda')).toBe(true);
      expect(cfg.contains('dd if=/dev/zero of=/dev/sda')).toBe(true);
      expect(cfg.contains('shutdown -h now')).toBe(true);
      expect(cfg.contains('reboot')).toBe(true);
    });

    test('contains() returns false when first token is not exact match (mkfs.ext4 vs mkfs)', () => {
      const cfg = new ShellBlacklistConfigService(null);
      // First token check is strict; 'mkfs.ext4' is a different binary token
      // than 'mkfs'. The legacy regex layer in ShellBlacklistPolicy still
      // catches `mkfs.ext4` via `/\bmkfs\b/`.
      expect(cfg.contains('mkfs.ext4 /dev/sda')).toBe(false);
    });

    test('contains() returns false for safe first token', () => {
      const cfg = new ShellBlacklistConfigService(null);
      expect(cfg.contains('ls -la')).toBe(false);
      expect(cfg.contains('echo hello')).toBe(false);
      expect(cfg.contains('git status')).toBe(false);
    });

    test('contains() returns false for empty / non-string input', () => {
      const cfg = new ShellBlacklistConfigService(null);
      expect(cfg.contains('')).toBe(false);
      expect(cfg.contains('   ')).toBe(false);
      expect(cfg.contains(null as unknown as string)).toBe(false);
    });

    test('initialBlacklist override seeds list during construction', () => {
      const cfg = new ShellBlacklistConfigService(null, {
        initialBlacklist: ['curl', 'wget'],
      });
      expect(cfg.contains('curl http://x')).toBe(true);
      expect(cfg.contains('wget -O - http://x')).toBe(true);
      expect(cfg.contains('rm -rf /')).toBe(false); // not seeded
    });

    test('empty initialBlacklist falls back to DEFAULT', () => {
      const cfg = new ShellBlacklistConfigService(null, { initialBlacklist: [] });
      expect(cfg.current()).toEqual([...DEFAULT_SHELL_BLACKLIST]);
    });
  });

  describe('Nacos hot-reload', () => {
    test('start() loads snapshot + applies commands array', async () => {
      const stub = makeNacosStub();
      stub.primeSnapshot({
        dataId: 'agentic.engine.safety.shellBlacklist.yaml',
        group: 'agentic-engine-safety',
        namespace: 'agentic-engine',
        version: 1,
        updateTime: Date.now(),
        content: { commands: ['curl', 'wget', 'nc'] },
      });

      const cfg = new ShellBlacklistConfigService(stub.observer);
      await cfg.start();

      expect(cfg.contains('curl http://x')).toBe(true);
      expect(cfg.contains('wget -O - http://x')).toBe(true);
      expect(cfg.contains('rm -rf /')).toBe(false); // replaced by Nacos config
    });

    test('subscribe() fires hot-reload', async () => {
      const stub = makeNacosStub();
      const cfg = new ShellBlacklistConfigService(stub.observer);
      await cfg.start();

      // Initial: defaults (no snapshot primed)
      expect(cfg.contains('rm -rf /')).toBe(true);
      expect(cfg.contains('curl http://x')).toBe(false);

      // Publish a Nacos update
      await stub.publish({
        dataId: 'agentic.engine.safety.shellBlacklist.yaml',
        group: 'agentic-engine-safety',
        namespace: 'agentic-engine',
        version: 2,
        updateTime: Date.now(),
        content: { commands: ['curl', 'wget'] },
      });

      expect(cfg.contains('curl http://x')).toBe(true);
      expect(cfg.contains('rm -rf /')).toBe(false);
    });

    test('YAML string payload parsed correctly', () => {
      const cfg = new ShellBlacklistConfigService(null);
      cfg.__applyForTest('commands:\n  - rm\n  - mkfs\n  - chmod\n');
      expect(cfg.contains('rm -rf /')).toBe(true);
      expect(cfg.contains('mkfs /dev/sda')).toBe(true);
      expect(cfg.contains('chmod 777 /')).toBe(true);
      expect([...cfg.current()].sort()).toEqual(['chmod', 'mkfs', 'rm']);
    });

    test('empty commands array → falls back to DEFAULT', () => {
      const cfg = new ShellBlacklistConfigService(null);
      cfg.__applyForTest({ commands: [] });
      expect(cfg.current()).toEqual([...DEFAULT_SHELL_BLACKLIST]);
    });

    test('non-string entries filtered out', () => {
      const cfg = new ShellBlacklistConfigService(null);
      cfg.__applyForTest({ commands: ['rm', 42, null, 'curl', undefined] });
      expect([...cfg.current()].sort()).toEqual(['curl', 'rm']);
    });

    test('malformed yaml → keeps previous list (logged warn)', () => {
      const warnFn = mock(() => {});
      const cfg = new ShellBlacklistConfigService(null, {
        logger: { warn: warnFn },
      });
      // Seed with custom list
      cfg.__applyForTest({ commands: ['curl'] });
      expect(cfg.current()).toEqual(['curl']);

      // Apply garbage YAML
      cfg.__applyForTest('::: invalid yaml :::\n  commands: [rm');
      // Garbage YAML may or may not throw; either way, must not corrupt list.
      // We accept either:
      //  - parser tolerated → list stays ['curl'] (no commands key)
      //  - parser threw     → catch block keeps ['curl']
      expect(cfg.current()).toEqual(['curl']);
    });

    test('null / undefined / empty string content → no-op', () => {
      const cfg = new ShellBlacklistConfigService(null);
      cfg.__applyForTest({ commands: ['curl'] });
      const before = cfg.current();
      cfg.__applyForTest(null);
      cfg.__applyForTest(undefined);
      cfg.__applyForTest('');
      cfg.__applyForTest('   ');
      expect(cfg.current()).toEqual(before);
    });

    test('subscribe() failure during start() does not throw', async () => {
      const observer: NacosConfigObserver = {
        async subscribe() {
          throw new Error('nacos unavailable');
        },
        async getSnapshot() {
          throw new Error('nacos unavailable');
        },
        async start() {},
        async stop() {},
      };
      const warnFn = mock(() => {});
      const cfg = new ShellBlacklistConfigService(observer, {
        logger: { warn: warnFn },
      });
      await cfg.start();
      expect(cfg.current()).toEqual([...DEFAULT_SHELL_BLACKLIST]);
      expect(warnFn).toHaveBeenCalled();
    });
  });
});

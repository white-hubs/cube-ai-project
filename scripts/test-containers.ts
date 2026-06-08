#!/usr/bin/env bun

/**
 * Testcontainers E2E matrix — runs all `*.testcontainers.test.ts` under packages/ and infra/.
 *
 * 退出策略：
 *   1. SIGINT/SIGTERM → 转发给子进程 `bun test`，等待其 teardown（含 afterAll）
 *   2. 子进程退出后 → 兜底 sweep 仍带 org.testcontainers 标签的孤儿容器
 *      （Bun 常在异步 container.stop() 完成前就退出，Ryuk 也可能未跟上）
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cleanupTestcontainersOrphans } from './lib/testcontainers-cleanup';

const root = `${import.meta.dir}/..`;
const TIMEOUT_MS = 1_800_000;
/** 中断后等待子进程 graceful teardown 的最长时间，超时则 SIGKILL */
const CHILD_TEARDOWN_GRACE_MS = 90_000;

function collectTestcontainersFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      collectTestcontainersFiles(abs, acc);
      continue;
    }
    if (name.endsWith('.testcontainers.test.ts')) {
      acc.push(abs);
    }
  }
  return acc;
}

const roots = ['packages', 'infra'].map((r) => `${root}/${r}`);
const files = roots.flatMap((r) => collectTestcontainersFiles(r)).sort();

if (files.length === 0) {
  console.error('[test:containers] no *.testcontainers.test.ts files found');
  process.exit(1);
}

const relFiles = files.map((f) => relative(root, f));
console.log(`[test:containers] ${relFiles.length} files, timeout=${TIMEOUT_MS}ms`);

function spawnTestRunner(): ChildProcess {
  return spawn(process.execPath, ['test', '--timeout', String(TIMEOUT_MS), ...relFiles], {
    cwd: root,
    env: {
      ...process.env,
      USE_TESTCONTAINERS: '1',
      USE_NACOS_TESTCONTAINERS: process.env['USE_NACOS_TESTCONTAINERS'] ?? '1',
    },
    stdio: 'inherit',
  });
}

let receivedSignal: NodeJS.Signals | null = null;
let killTimer: ReturnType<typeof setTimeout> | null = null;

function forwardSignalToChild(child: ChildProcess, sig: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null || child.killed) return;
  child.kill(sig);
}

const child = spawnTestRunner();

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(sig, () => {
    if (receivedSignal) return;
    receivedSignal = sig;
    console.error(`\n[test:containers] received ${sig}, forwarding to test runner…`);
    forwardSignalToChild(child, sig);
    killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        console.error('[test:containers] child teardown timeout, sending SIGKILL');
        try {
          child.kill('SIGKILL');
        } catch {
          /* ignore */
        }
      }
    }, CHILD_TEARDOWN_GRACE_MS);
  });
}

const exitCode = await new Promise<number>((resolve) => {
  child.on('exit', (code, signal) => {
    if (killTimer) clearTimeout(killTimer);
    if (code !== null) resolve(code);
    else resolve(signal ? 1 : 0);
  });
  child.on('error', () => resolve(1));
});

// 兜底：无论正常结束还是中断，清掉仍残留的 Testcontainers 容器
try {
  const removed = cleanupTestcontainersOrphans({ quiet: true });
  if (removed > 0) {
    console.log(
      `[test:containers] swept ${removed} orphan container(s) after test runner exit`,
    );
  }
} catch (e) {
  console.error(
    `[test:containers] orphan sweep failed: ${e instanceof Error ? e.message : e}`,
  );
}

if (receivedSignal) {
  const code =
    receivedSignal === 'SIGINT' ? 130 : receivedSignal === 'SIGTERM' ? 143 : 129;
  process.exit(code);
}

process.exit(exitCode);

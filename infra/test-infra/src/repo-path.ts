import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Bun 可执行文件：子进程 `spawn('bun')` 在 IDE/CI 下常不在 PATH，用当前 runtime。 */
export function resolveBunExecutable(): string {
  const fromEnv = process.env['BUN_TEST_EXECUTABLE']?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const install = process.env['BUN_INSTALL']?.trim();
  if (install) {
    const candidate = join(install, 'bin', 'bun');
    if (existsSync(candidate)) return candidate;
  }

  return process.execPath;
}

/**
 * 从任意仓库内路径向上查找 monorepo 根（含 `bun.lock` + workspaces `package.json`）。
 * 兼容 v6 布局 `packages/agent/engine` 与源仓扁平 `packages/engine`。
 */
export function findMonorepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 14; i++) {
    const lock = join(dir, 'bun.lock');
    const pkg = join(dir, 'package.json');
    if (existsSync(lock) && existsSync(pkg)) {
      try {
        const parsed = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown };
        if (parsed.workspaces) return dir;
      } catch {
        /* continue walking */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`[test-infra] monorepo root not found from ${startDir}`);
}

/** 从测试文件所在目录（`import.meta.dir`）解析 monorepo 根。 */
export function resolveMonorepoRootFromImporter(importerDir: string): string {
  return findMonorepoRoot(importerDir);
}

/** 解析 agent-engine 包目录（含 `src/main.ts`）。 */
export function resolveEnginePackageDir(repoRoot: string): string {
  const candidates = [
    join(repoRoot, 'packages', 'agent', 'engine'),
    join(repoRoot, 'packages', 'engine'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'src', 'main.ts'))) return dir;
  }
  throw new Error(
    `[test-infra] engine package not found under ${repoRoot} (tried packages/agent/engine, packages/engine)`,
  );
}

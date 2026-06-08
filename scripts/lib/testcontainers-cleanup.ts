import { spawnSync } from 'node:child_process';

export interface CleanupTestcontainersOptions {
  dryRun?: boolean;
  /** 无容器时不打印（用于 test:containers 正常结束后的静默 sweep） */
  quiet?: boolean;
}

function docker(args: string[]): string {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0 && !r.stdout?.trim() && !r.stderr?.includes('filter')) {
    throw new Error(r.stderr || `docker ${args.join(' ')} failed`);
  }
  return (r.stdout ?? '').trim();
}

/** 删除带 `org.testcontainers=true` 标签的容器及 Ryuk。返回删除数量。 */
export function cleanupTestcontainersOrphans(
  options: CleanupTestcontainersOptions = {},
): number {
  const dryRun = options.dryRun === true;
  const quiet = options.quiet === true;

  const ids = docker([
    'ps',
    '-aq',
    '--filter',
    'label=org.testcontainers=true',
  ])
    .split('\n')
    .filter(Boolean);

  const ryukIds = docker([
    'ps',
    '-aq',
    '--filter',
    'ancestor=testcontainers/ryuk',
  ])
    .split('\n')
    .filter(Boolean);

  const all = [...new Set([...ids, ...ryukIds])];

  if (all.length === 0) {
    if (!quiet) {
      console.log('[test:containers:cleanup] no testcontainers labels found');
    }
    return 0;
  }

  console.log(
    `[test:containers:cleanup] ${all.length} container(s)${dryRun ? ' (dry-run)' : ''}`,
  );

  for (const id of all) {
    const name = docker(['inspect', '--format', '{{.Name}}', id]).replace(/^\//, '');
    const image = docker(['inspect', '--format', '{{.Config.Image}}', id]);
    console.log(`  - ${name} (${image})`);
  }

  if (dryRun) return all.length;

  const rm = spawnSync('docker', ['rm', '-f', ...all], { encoding: 'utf8' });
  if (rm.status !== 0) {
    throw new Error(rm.stderr || '[test:containers:cleanup] docker rm failed');
  }

  if (!quiet) {
    console.log('[test:containers:cleanup] done');
  }
  return all.length;
}

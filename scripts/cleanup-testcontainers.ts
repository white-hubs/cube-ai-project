#!/usr/bin/env bun

/**
 * 清理 Testcontainers 遗留容器（label: org.testcontainers=true）及孤立的 Ryuk。
 *
 *   bun run test:containers:cleanup
 *   bun run test:containers:cleanup -- --dry-run
 */

import { cleanupTestcontainersOrphans } from './lib/testcontainers-cleanup';

const dryRun = process.argv.includes('--dry-run');

try {
  cleanupTestcontainersOrphans({ dryRun });
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

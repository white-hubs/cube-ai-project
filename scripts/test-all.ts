#!/usr/bin/env bun

/**
 * Full offline test matrix — each suite runs in its package cwd so bunfig/tsconfig
 * preload and legacy decorators resolve correctly.
 */

const root = `${import.meta.dir}/..`;

const suites: Array<{ cwd: string; label: string; args?: string[] }> = [
  { cwd: 'packages/contracts', label: '@cube-ai/contracts' },
  { cwd: 'packages/llm/core', label: '@cube-ai/llm-core' },
  { cwd: 'packages/flow/core', label: '@cube-ai/flow-core' },
  { cwd: 'infra/bun-server-ext/sse', label: '@cube-ai/bun-server-ext-sse' },
  { cwd: 'infra/bun-server-ext/outbox', label: '@cube-ai/bun-server-ext-outbox' },
  { cwd: 'infra/vector-qdrant', label: '@cube-ai/vector-qdrant' },
  { cwd: 'packages/embedding', label: '@cube-ai/embedding' },
  { cwd: 'packages/kb/core', label: '@cube-ai/kb-core' },
  { cwd: 'packages/agent/engine', label: '@cube-ai/agent-engine', args: ['--timeout', '120000'] },
  { cwd: 'packages/agent/sdk-client', label: '@cube-ai/agent-sdk-client' },
  { cwd: 'packages/agent/sdk-client-assistant', label: '@cube-ai/agent-sdk-client-assistant' },
  { cwd: 'packages/agent/sdk-client-mock', label: '@cube-ai/agent-sdk-client-mock' },
  { cwd: 'packages/agent/sdk-client-vue', label: '@cube-ai/agent-sdk-client-vue' },
  { cwd: 'packages/flow/sdk-client', label: '@cube-ai/flow-sdk-client' },
  { cwd: 'packages/flow/sdk-console', label: '@cube-ai/flow-sdk-console' },
  { cwd: 'packages/kb/sdk-client', label: '@cube-ai/kb-sdk-client' },
  { cwd: 'packages/kb/sdk-console', label: '@cube-ai/kb-sdk-console' },
  { cwd: 'packages/llm/sdk-console', label: '@cube-ai/llm-sdk-console' },
  { cwd: 'apps/ai-console', label: '@cube-ai/ai-console' },
  { cwd: 'packages/platform-adapters/ghcloud', label: '@cube-ai/platform-adapter-ghcloud' },
  { cwd: 'tools/migration', label: 'tools/migration' },
  { cwd: 'apps/ai-center', label: '@cube-ai/ai-center' },
];

let exitCode = 0;
let totalPass = 0;
let totalSkip = 0;
let totalFail = 0;
let suitesRun = 0;

for (const suite of suites) {
  const proc = Bun.spawn(['bun', 'test', ...(suite.args ?? [])], {
    cwd: `${root}/${suite.cwd}`,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const output = `${stdout}\n${stderr}`;
  if (output.includes('No tests found!')) {
    console.log(`[test:all] ${suite.label} SKIP (no tests)`);
    continue;
  }

  suitesRun += 1;
  const passMatch = output.match(/(\d+) pass/);
  const skipMatch = output.match(/(\d+) skip/);
  const failMatch = output.match(/(\d+) fail/);
  if (passMatch) totalPass += Number(passMatch[1]);
  if (skipMatch) totalSkip += Number(skipMatch[1]);
  if (failMatch) totalFail += Number(failMatch[1]);

  if (code !== 0) {
    console.error(`\n[test:all] ${suite.label} FAILED (exit ${code})`);
    if (stdout.trim()) console.error(stdout);
    if (stderr.trim()) console.error(stderr);
    exitCode = code;
  } else {
    console.log(`[test:all] ${suite.label} OK`);
  }
}

console.log(
  `\n[test:all] aggregate: ${totalPass} pass / ${totalSkip} skip / ${totalFail} fail across ${suitesRun} suites`,
);

process.exit(exitCode);

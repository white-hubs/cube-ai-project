#!/usr/bin/env bun

const suites = [
  { cwd: "packages/kb/core", label: "@cube-ai/kb-core" },
  { cwd: "infra/vector-qdrant", label: "@cube-ai/vector-qdrant" },
  { cwd: "packages/embedding", label: "@cube-ai/embedding" },
];

let exitCode = 0;

for (const suite of suites) {
  const proc = Bun.spawn(["bun", "test"], {
    cwd: `${import.meta.dir}/../${suite.cwd}`,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    console.error(`[test:m3] ${suite.label} failed with exit ${code}`);
    exitCode = code;
  }
}

process.exit(exitCode);

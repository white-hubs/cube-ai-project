import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.join(import.meta.dir, '../../../..');

const FORBIDDEN_BC_CAPABILITY_IMPORTS = [
  /^@cube-ai\/flow-core(?:\/|$)/,
  /^@cube-ai\/kb-core(?:\/|$)/,
  /^@cube-ai\/llm-core(?:\/|$)/,
  /^@cube-ai\/embedding(?:\/|$)/,
  /^@cube-ai\/platform-adapter(?:\/|$)/,
];

const ADAPTER_LAYER_DOMAIN_IMPORTS = [
  /^@cube-ai\/kb-core(?:\/|$)/,
  /^@cube-ai\/llm-core(?:\/|$)/,
];

const COMPOSITION_ROOT_FORBIDDEN_IMPORTS = [
  /^@cube-ai\/kb-core(?:\/|$)/,
  /^@cube-ai\/embedding(?:\/|$)/,
  /^@cube-ai\/platform-adapter(?:\/|$)/,
];

const COMPOSITION_ROOT_FILES = [
  'apps/ai-center/src/assembler/ai-center-assembler.ts',
  'apps/ai-center/src/bootstrap.ts',
  'apps/ai-center/src/routes/ai-center-domain-http.module.ts',
];

const BC_PLATFORM_TOKEN_HANDLERS = [
  'packages/agent/engine/src/bc/tools/handlers/flow-handler.ts',
  'packages/agent/engine/src/bc/tools/handlers/flow-list-handler.ts',
  'packages/agent/engine/src/bc/tools/handlers/knowledge-handler.ts',
  'packages/agent/engine/src/bc/tools/handlers/qwen-image-handler.ts',
];

async function collectSourceFiles(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      await collectSourceFiles(fullPath, acc);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) acc.push(fullPath);
  }
  return acc;
}

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importRe = /\bfrom\s+['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(importRe)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function isProductionSource(filePath: string): boolean {
  return !/\.(test|e2e\.test)\.ts$/.test(filePath);
}

function relative(filePath: string): string {
  return path.relative(repoRoot, filePath);
}

describe('composition root import boundary (ADR-0002)', () => {
  test('agent-engine BC layer does not import capability packages directly', async () => {
    const bcDir = path.join(repoRoot, 'packages/agent/engine/src/bc');
    const files = (await collectSourceFiles(bcDir)).filter(isProductionSource);
    const violations: string[] = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of extractImportSpecifiers(source)) {
        if (FORBIDDEN_BC_CAPABILITY_IMPORTS.some((pattern) => pattern.test(specifier))) {
          violations.push(`${relative(file)} → ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('capability package wiring stays in agent-engine adapters layer', async () => {
    const adaptersDir = path.join(repoRoot, 'packages/agent/engine/src/adapters');
    const files = await collectSourceFiles(adaptersDir);
    const domainHits = new Set<string>();

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of extractImportSpecifiers(source)) {
        for (const pattern of ADAPTER_LAYER_DOMAIN_IMPORTS) {
          if (pattern.test(specifier)) domainHits.add(specifier);
        }
      }
    }

    expect(domainHits.size).toBeGreaterThan(0);
  });

  test('BC cross-domain handlers resolve ports via contracts platform tokens', async () => {
    for (const relPath of BC_PLATFORM_TOKEN_HANDLERS) {
      const source = await readFile(path.join(repoRoot, relPath), 'utf8');
      expect(source.includes('@cube-ai/contracts/platform')).toBe(true);
      expect(source.includes('AGENTIC_PLATFORM_')).toBe(true);
    }
  });

  test('composition root wires modules instead of kb-core implementations', async () => {
    const violations: string[] = [];

    for (const relPath of COMPOSITION_ROOT_FILES) {
      const source = await readFile(path.join(repoRoot, relPath), 'utf8');
      for (const specifier of extractImportSpecifiers(source)) {
        if (COMPOSITION_ROOT_FORBIDDEN_IMPORTS.some((pattern) => pattern.test(specifier))) {
          violations.push(`${relPath} → ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('no @cube-ai/shared imports remain in workspace source', async () => {
    const scanRoots = ['apps', 'packages', 'infra', 'tools'];
    const violations: string[] = [];
    const sharedImportRe = /from\s+['"]@cube-ai\/shared['"]/;

    for (const scanRoot of scanRoots) {
      const files = await collectSourceFiles(path.join(repoRoot, scanRoot));
      for (const file of files) {
        const source = await readFile(file, 'utf8');
        if (sharedImportRe.test(source)) {
          violations.push(relative(file));
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('no @cube-ai/shared workspace dependency remains', async () => {
    const packageFiles = await collectSourceFiles(repoRoot);
    const packageJsonFiles = packageFiles.filter((file) => file.endsWith('package.json'));
    const violations: string[] = [];

    for (const file of packageJsonFiles) {
      const source = await readFile(file, 'utf8');
      if (source.includes('"@cube-ai/shared"')) {
        violations.push(relative(file));
      }
    }

    expect(violations).toEqual([]);
  });

  test('agent-sdk packages do not reference legacy cube-agentic-engine ADR numbers', async () => {
    const sdkRoots = [
      'packages/agent/sdk-client',
      'packages/agent/sdk-client-assistant',
      'packages/agent/sdk-client-mock',
      'packages/agent/sdk-client-vue',
    ];
    const legacyAdrRe = /ADR-00(?:1[4-9]|2[0-9])/;
    const violations: string[] = [];

    for (const sdkRoot of sdkRoots) {
      const files = await collectSourceFiles(path.join(repoRoot, sdkRoot));
      for (const file of files) {
        const source = await readFile(file, 'utf8');
        if (legacyAdrRe.test(source)) {
          violations.push(`${relative(file)}: legacy ADR reference`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

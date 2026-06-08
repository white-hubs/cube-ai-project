#!/usr/bin/env bun
/** Strip assistant toy residue from flow-core DB layer (M4.T3). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');

function patch(path: string, fn: (s: string) => string) {
  const full = join(root, path);
  writeFileSync(full, fn(readFileSync(full, 'utf8')), 'utf8');
}

// repository-contracts.ts — drop assistant methods + types
patch('src/db/repository-contracts.ts', (s) => {
  let out = s
    .replace(/\n  PlatformAssistantMessageRow,\n  PlatformAssistantSessionRow,/g, '')
    .replace(
      /\n  createAssistantSession[\s\S]*?  appendAssistantAudit\(action: string, detail: Record<string, unknown>\): Awaitable<void>\n/,
      '\n',
    );
  return out;
});

// shared-repositories placeholder
patch('src/db/shared-repositories.ts', (s) =>
  s.replace(/\n  createAssistantSession[\s\S]*?  appendAssistantAudit\(\): void \{ this\.unsupported\('appendAssistantAudit'\) \}\n/, '\n'),
);

// sqlite.ts — DDL block + types + methods + migration refs
patch('src/db/sqlite.ts', (s) => {
  let out = s.replace(
    /CREATE TABLE IF NOT EXISTS platform_assistant_sessions[\s\S]*?CREATE TABLE IF NOT EXISTS assistant_audit_log \([\s\S]*?\);\n\n/,
    '',
  );
  out = out.replace(/\nexport type PlatformAssistantSessionRow[\s\S]*?export type PlatformAssistantMessageRow[\s\S]*?\}\n/, '\n');
  out = out.replace(/\n  \/\/ --- Platform AI assistant[\s\S]*?\n  listCustomComponentTemplates\(/, '\n  listCustomComponentTemplates(');
  out = out.replace(/      'platform_assistant_sessions',\n      'platform_assistant_messages',\n      'assistant_proposals',\n      'assistant_audit_log',\n/g, '');
  out = out.replace(
    /\n    const pam = this\.tableColumnNames\('platform_assistant_messages'\)[\s\S]*?\n    const aal = this\.tableColumnNames\('assistant_audit_log'\)[\s\S]*?\n    \}\n\n    const akv/,
    '\n\n    const akv',
  );
  return out;
});

// mysql-repositories.ts — drop assistant imports + methods
patch('src/db/mysql-repositories.ts', (s) => {
  let out = s
    .replace(/\n  type PlatformAssistantMessageRow,\n  type PlatformAssistantSessionRow,/g, '')
    .replace(/\nfunction normalizeAssistantSessionRow[\s\S]*?function normalizeAssistantMessageRow[\s\S]*?\}\n/, '\n');
  out = out.replace(
    /\n  public async createAssistantSession[\s\S]*?\n  public async appendAssistantAudit[\s\S]*?\n  \}\n\n  public async listCustomComponentTemplates/,
    '\n\n  public async listCustomComponentTemplates',
  );
  return out;
});

console.log('assistant strip complete');

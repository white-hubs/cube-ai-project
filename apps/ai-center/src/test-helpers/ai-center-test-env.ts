import { _resetAppConfigCache } from '@cube-ai/ai-center/platform/server-base';
import { _resetAppConfigCache as resetKbAppConfigCache } from '@cube-ai/kb-core';

const ENV_KEYS = [
  'AGENTIC_ENGINE_SECRETS_SOURCE',
  'AGENTIC_ENGINE_MEMORY_KIND',
  'AGENTIC_ENGINE_PROVIDER',
  'AGENTIC_ENGINE_DESCRIPTOR_LOCAL_DIR',
  'CUBE_LOCAL_DEV',
  'CUBE_AI_SQLITE_PATH',
  'AGENTIC_ENGINE_REDIS_URL',
  'REDIS_URL',
  'CUBE_AI_MOCK',
  'CUBE_AI_MOCK_FLOWS',
  'USE_GHCLOUD_IDENTITY',
  'JWT_KEY_URL',
] as const;

export function snapshotAiCenterTestEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

export function applyAiCenterTestEnv(sqlitePath: string): void {
  process.env.AGENTIC_ENGINE_SECRETS_SOURCE = 'env';
  process.env.AGENTIC_ENGINE_MEMORY_KIND = 'in-memory';
  process.env.AGENTIC_ENGINE_PROVIDER = 'noop';
  process.env.AGENTIC_ENGINE_DESCRIPTOR_LOCAL_DIR = '';
  process.env.CUBE_LOCAL_DEV = '1';
  process.env.CUBE_AI_SQLITE_PATH = sqlitePath;
  delete process.env.AGENTIC_ENGINE_REDIS_URL;
  delete process.env.REDIS_URL;
  _resetAppConfigCache();
  resetKbAppConfigCache();
}

export function restoreAiCenterTestEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  _resetAppConfigCache();
  resetKbAppConfigCache();
}

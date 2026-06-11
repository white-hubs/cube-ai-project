import { afterEach, describe, expect, test } from 'bun:test';
import { buildKbMysqlConfigFromEnv, hasKbMysqlConfigFromEnv } from './kb-mysql-database.service';

const ENV_KEYS = [
  'MYSQL_HOST',
  'MYSQL_PORT',
  'MYSQL_DATABASE',
  'MYSQL_DB',
  'MYSQL_USERNAME',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'KB_MYSQL_URL',
  'AGENTIC_ENGINE_MYSQL_URL',
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(overrides: Partial<Record<(typeof ENV_KEYS)[number], string>>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
    delete Bun.env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved.entries()) {
    if (value === undefined) {
      delete process.env[key];
      delete Bun.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
});

describe('buildKbMysqlConfigFromEnv', () => {
  test('falls back to AGENTIC_ENGINE_MYSQL_URL when discrete MYSQL_* are unset (engine standalone / testcontainers)', () => {
    setEnv({ AGENTIC_ENGINE_MYSQL_URL: 'mysql://eng:s3cret@10.0.0.9:32768/agentic_engine' });
    expect(buildKbMysqlConfigFromEnv()).toEqual({
      host: '10.0.0.9',
      port: 32768,
      database: 'agentic_engine',
      user: 'eng',
      password: 's3cret',
    });
  });

  test('KB_MYSQL_URL takes precedence over AGENTIC_ENGINE_MYSQL_URL', () => {
    setEnv({
      KB_MYSQL_URL: 'mysql://kb:kbpw@kb-host:3307/kb_db',
      AGENTIC_ENGINE_MYSQL_URL: 'mysql://eng:engpw@eng-host:3306/agentic_engine',
    });
    const cfg = buildKbMysqlConfigFromEnv();
    expect(cfg.host).toBe('kb-host');
    expect(cfg.port).toBe(3307);
    expect(cfg.database).toBe('kb_db');
  });

  test('discrete MYSQL_* env vars override URL-derived values (compose convention)', () => {
    setEnv({
      MYSQL_HOST: 'compose-mysql',
      MYSQL_PORT: '3306',
      MYSQL_USERNAME: 'agentic_engine',
      MYSQL_PASSWORD: 'dev',
      AGENTIC_ENGINE_MYSQL_URL: 'mysql://other:pw@elsewhere:9999/otherdb',
    });
    const cfg = buildKbMysqlConfigFromEnv();
    expect(cfg.host).toBe('compose-mysql');
    expect(cfg.port).toBe(3306);
    expect(cfg.user).toBe('agentic_engine');
  });

  test('defaults apply when nothing configured', () => {
    setEnv({});
    expect(buildKbMysqlConfigFromEnv()).toEqual({
      host: '127.0.0.1',
      port: 3306,
      database: 'agentic_engine',
      user: 'root',
      password: '',
    });
  });

  test('malformed URL is ignored, defaults apply', () => {
    setEnv({ AGENTIC_ENGINE_MYSQL_URL: 'not-a-url' });
    const cfg = buildKbMysqlConfigFromEnv();
    expect(cfg.host).toBe('127.0.0.1');
  });
});

describe('hasKbMysqlConfigFromEnv', () => {
  test('false when no source configured', () => {
    setEnv({});
    expect(hasKbMysqlConfigFromEnv()).toBe(false);
  });

  test('true with AGENTIC_ENGINE_MYSQL_URL', () => {
    setEnv({ AGENTIC_ENGINE_MYSQL_URL: 'mysql://u:p@h:3306/db' });
    expect(hasKbMysqlConfigFromEnv()).toBe(true);
  });

  test('true with MYSQL_HOST', () => {
    setEnv({ MYSQL_HOST: 'somewhere' });
    expect(hasKbMysqlConfigFromEnv()).toBe(true);
  });
});

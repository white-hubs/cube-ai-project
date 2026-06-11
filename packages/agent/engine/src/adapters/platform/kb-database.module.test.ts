import { describe, expect, test } from 'bun:test';
import { EngineKbDatabaseBootstrap } from './kb-database.module';

describe('EngineKbDatabaseBootstrap', () => {
  test('skips initialize when no MySQL env configured (offline engine boot stays up)', async () => {
    const calls: string[] = [];
    const fakeDb = {
      initialize: async () => {
        calls.push('initialize');
      },
      query: async () => {
        calls.push('query');
        return [];
      },
    };
    const savedHost = process.env['MYSQL_HOST'];
    const savedKbUrl = process.env['KB_MYSQL_URL'];
    const savedEngineUrl = process.env['AGENTIC_ENGINE_MYSQL_URL'];
    delete process.env['MYSQL_HOST'];
    delete process.env['KB_MYSQL_URL'];
    delete process.env['AGENTIC_ENGINE_MYSQL_URL'];
    delete Bun.env['MYSQL_HOST'];
    delete Bun.env['KB_MYSQL_URL'];
    delete Bun.env['AGENTIC_ENGINE_MYSQL_URL'];
    try {
      const bootstrap = new EngineKbDatabaseBootstrap(
        fakeDb as unknown as ConstructorParameters<typeof EngineKbDatabaseBootstrap>[0],
      );
      await bootstrap.onModuleInit();
      expect(calls).toEqual([]);
    } finally {
      if (savedHost !== undefined) process.env['MYSQL_HOST'] = savedHost;
      if (savedKbUrl !== undefined) process.env['KB_MYSQL_URL'] = savedKbUrl;
      if (savedEngineUrl !== undefined) process.env['AGENTIC_ENGINE_MYSQL_URL'] = savedEngineUrl;
    }
  });

  test('initializes and applies kb schema when MySQL env configured', async () => {
    const calls: string[] = [];
    const fakeDb = {
      initialize: async () => {
        calls.push('initialize');
      },
      query: async (sql: string) => {
        calls.push(`query:${sql.slice(0, 30)}`);
        return [];
      },
    };
    const saved = process.env['AGENTIC_ENGINE_MYSQL_URL'];
    process.env['AGENTIC_ENGINE_MYSQL_URL'] = 'mysql://u:p@127.0.0.1:3306/agentic_engine';
    try {
      const bootstrap = new EngineKbDatabaseBootstrap(
        fakeDb as unknown as ConstructorParameters<typeof EngineKbDatabaseBootstrap>[0],
      );
      await bootstrap.onModuleInit();
      expect(calls[0]).toBe('initialize');
      expect(calls.length).toBeGreaterThan(1);
      expect(calls.slice(1).every((c) => c.startsWith('query:'))).toBe(true);
    } finally {
      if (saved === undefined) delete process.env['AGENTIC_ENGINE_MYSQL_URL'];
      else process.env['AGENTIC_ENGINE_MYSQL_URL'] = saved;
    }
  });
});

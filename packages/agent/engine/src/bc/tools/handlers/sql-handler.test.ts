/**
 * SqlHandler 单测（无真实 MySQL 时验证配置缺失 / 语法路径）。
 */
import { describe, test, expect } from 'bun:test';
import { SqlHandler } from './sql-handler';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';

const MOCK_CTX: ToolHandlerCtx = {
  traceId: 't',
  signal:  new AbortController().signal,
  auth:    { tenant: 1, user: { userId: '1', scopes: [] } },
  session: { id: '1234567890123456789', turnId: '1234567890123456788' },
};

describe('SqlHandler', () => {
  test('未配置 MySQL URL → INTERNAL_SQL_NOT_CONFIGURED', async () => {
    const prev = process.env['AGENTIC_ENGINE_MYSQL_URL'];
    delete process.env['AGENTIC_ENGINE_MYSQL_URL'];
    const h = new SqlHandler();
    await expect(
      h.invoke({ dataSourceId: 'default', query: 'SELECT 1' }, MOCK_CTX),
    ).rejects.toMatchObject({ code: 'INTERNAL_SQL_NOT_CONFIGURED' });
    if (prev !== undefined) process.env['AGENTIC_ENGINE_MYSQL_URL'] = prev;
  });

  test('写 SQL + readOnly 默认 → PERMISSION_DENIED_SQL_WRITE_BLOCKED', async () => {
    const h = new SqlHandler();
    await expect(
      h.invoke({ dataSourceId: 'default', query: 'DELETE FROM t WHERE id=1' }, MOCK_CTX),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED_SQL_WRITE_BLOCKED' });
  });
});

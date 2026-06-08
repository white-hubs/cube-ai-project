/**
 * SqlHandler — mysql2 执行 SQL；默认只读，写操作需显式允许或 readOnly:false + 环境白名单。
 *
 * 权威来源：docs/detailed-design/07-tools/builtin-catalog.md
 */
import { Injectable } from '@dangao/bun-server';
import mysql from 'mysql2/promise';
import { AgenticEngineError } from '../../../infra/errors/agentic-error';
import type { ToolHandlerCtx } from '../tool-context';
import type { ToolHandler } from './base-handler';

export interface SqlHandlerInput {
  dataSourceId: string;
  query:        string;
  params?:      unknown[];
  readOnly?:    boolean;
}

export interface SqlHandlerOutput {
  rows:         Record<string, unknown>[];
  rowCount:     number;
  affectedRows: number;
}

const WRITE_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|GRANT|REVOKE)\b/i;

/** 数据源 URL：AGENTIC_ENGINE_MYSQL_URL（默认）或 AGENTIC_ENGINE_SQL_DATASOURCE_<ID>_URL */
function resolveMysqlUrl(dataSourceId: string): string {
  const normalized = dataSourceId.replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();
  const specific =
    process.env[`AGENTIC_ENGINE_SQL_DATASOURCE_${normalized}_URL`] ??
    process.env[`AGENTIC_ENGINE_SQL_DATASOURCE_${dataSourceId}_URL`];
  const fallback = process.env['AGENTIC_ENGINE_MYSQL_URL'] ?? '';
  const url = (specific ?? fallback).trim();
  if (!url) {
    throw AgenticEngineError.fromCode(
      'INTERNAL_SQL_NOT_CONFIGURED',
      'SqlHandler: no MySQL URL for this data source (set AGENTIC_ENGINE_MYSQL_URL or AGENTIC_ENGINE_SQL_DATASOURCE_<ID>_URL)',
    );
  }
  return url;
}

const pools = new Map<string, mysql.Pool>();

function getPool(url: string): mysql.Pool {
  let p = pools.get(url);
  if (!p) {
    p = mysql.createPool(url);
    pools.set(url, p);
  }
  return p;
}

function writeAllowedForQuery(query: string): boolean {
  const raw = process.env['AGENTIC_ENGINE_SQL_WRITE_ALLOWLIST'] ?? '';
  if (raw === '*' || raw === 'ALL') return true;
  const patterns = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (patterns.length === 0) return false;
  const q = query.trim().toUpperCase();
  return patterns.some((pat) => q.includes(pat.toUpperCase()));
}

@Injectable()
export class SqlHandler implements ToolHandler<SqlHandlerInput, SqlHandlerOutput> {
  readonly kind = 'sql' as const;

  async invoke(input: SqlHandlerInput, _ctx: ToolHandlerCtx): Promise<SqlHandlerOutput> {
    const q = input.query.trim();
    if (!q) {
      throw AgenticEngineError.fromCode(
        'INVALID_ARGUMENT_SCHEMA_VIOLATION',
        'SqlHandler: empty query',
      );
    }

    const isWrite = WRITE_RE.test(q);
    const treatAsReadOnly = input.readOnly !== false;

    if (isWrite && treatAsReadOnly) {
      throw AgenticEngineError.fromCode(
        'PERMISSION_DENIED_SQL_WRITE_BLOCKED',
        'SqlHandler: write-like SQL blocked (descriptor/input read-only)',
      );
    }
    if (isWrite && !treatAsReadOnly && !writeAllowedForQuery(q)) {
      throw AgenticEngineError.fromCode(
        'PERMISSION_DENIED_SQL_WRITE_BLOCKED',
        'SqlHandler: write SQL not covered by AGENTIC_ENGINE_SQL_WRITE_ALLOWLIST',
      );
    }

    const url = resolveMysqlUrl(input.dataSourceId || 'default');
    const pool = getPool(url);

    try {
      const params = (input.params ?? []) as (string | number | boolean | null | Date)[];
      const [rows] = await pool.execute(q, params);
      if (Array.isArray(rows)) {
        const arr = rows as Record<string, unknown>[];
        return {
          rows:         arr,
          rowCount:     arr.length,
          affectedRows: 0,
        };
      }
      const rs = rows as mysql.ResultSetHeader;
      return {
        rows:         [],
        rowCount:     0,
        affectedRows: rs.affectedRows ?? 0,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw AgenticEngineError.fromCode(
        'UPSTREAM_SQL_EXECUTION_FAILED',
        `SqlHandler: ${msg}`,
      );
    }
  }
}

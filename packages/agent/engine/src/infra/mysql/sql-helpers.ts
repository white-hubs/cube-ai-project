import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

/** Allowed primitive value for mysql2 placeholder. */
export type SqlValue = string | number | boolean | null | Buffer | Date;

/**
 * Execute dynamic SQL with a runtime-built placeholder list — narrows mysql2
 * `execute` overload that otherwise demands a fixed tuple shape.
 */
export async function execDynamic(
  conn: Pool | PoolConnection,
  sql: string,
  params: ReadonlyArray<SqlValue>,
): Promise<ResultSetHeader> {
  const [res] = await conn.execute<ResultSetHeader>(sql, [...params]);
  return res;
}

/**
 * Query rows with a runtime-built placeholder list. Caller supplies the row
 * shape via type parameter `T extends RowDataPacket`.
 */
export async function queryRowsDynamic<T extends RowDataPacket>(
  conn: Pool | PoolConnection,
  sql: string,
  params: ReadonlyArray<SqlValue>,
): Promise<T[]> {
  const [rows] = await conn.execute<T[]>(sql, [...params]);
  return rows;
}

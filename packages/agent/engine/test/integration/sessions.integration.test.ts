/**
 * P3-04 Session REST — 真实流程断言（默认 `test.skip`，需 live engine + MySQL）。
 *
 * 前置：
 *   1. `AGENTIC_ENGINE_AUTH_MODE=mock`（默认）
 *   2. `AGENTIC_ENGINE_MYSQL_URL` 指向已迁移库（含 `sessions` / `outbox_events`）
 *   3. `bun run --filter @cube-ai/agent-engine dev`，`TEST_PORT` 与本文件一致（默认 4004，见 shared-context §4）
 *   4. 去掉各 `test.skip` 或设 `INTEGRATION_TESTS=1` 并按需改条件（本文件保持 skip 以符合 Q-M3-2）
 *
 * Testcontainers 等价场景：`mysql-redis-qdrant.testcontainers.test.ts`（`USE_TESTCONTAINERS=1`）。
 *
 * 权威：P3-04-session-rest.md §6、shared-context §5.3
 */
import { describe, test, expect } from 'bun:test';
import { createPool, type RowDataPacket } from 'mysql2/promise';

const PORT = Number(process.env['TEST_PORT'] ?? 4004);
const BASE = `http://127.0.0.1:${PORT}`;

const SFID_RE = /^\d{19}$/;

/** mock Obo：与 `oauth2-introspection.middleware` mock 模式一致 */
function mockHeaders(tenant: number, userId: string) {
  return {
    'Content-Type':  'application/json',
    'Authorization': 'Bearer test-token',
    'x-mock-tenant-id': String(tenant),
    'x-mock-user-id':    userId,
  } as const;
}

function parsePayload(row: RowDataPacket & { payload_json?: unknown }): Record<string, unknown> {
  const raw = row['payload_json'];
  if (raw == null) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw as Record<string, unknown>;
  const s = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  return JSON.parse(s) as Record<string, unknown>;
}

describe('[integration] Session REST (P3-04)', () => {
  test.skip('POST /sessions — 201，id 为 SFID；请求 JSON 不含 tenant（§API-4）', async () => {
    const tenant = 91_001;
    const body = { agentId: '18203000000000123', title: 'integration-create' };
    expect(Object.hasOwn(body, 'tenant')).toBe(false);

    const resp = await fetch(`${BASE}/sessions`, {
      method:  'POST',
      headers: mockHeaders(tenant, 'integ-user-a'),
      body:    JSON.stringify(body),
    });

    expect(resp.status).toBe(201);
    const json = (await resp.json()) as Record<string, unknown>;
    expect(typeof json['id']).toBe('string');
    expect(SFID_RE.test(String(json['id']))).toBe(true);
    expect(json).not.toHaveProperty('tenant');
  });

  test.skip('GET /sessions/:id — 非所属 tenant 返回 404（行级隔离）', async () => {
    const tenantA = 91_002;
    const tenantB = 91_003;
    const userA = 'integ-user-iso-a';

    const created = await fetch(`${BASE}/sessions`, {
      method:  'POST',
      headers: mockHeaders(tenantA, userA),
      body:    JSON.stringify({ agentId: '18203000000000123' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const wrongTenant = await fetch(`${BASE}/sessions/${id}`, {
      method:  'GET',
      headers: mockHeaders(tenantB, userA),
    });
    expect(wrongTenant.status).toBe(404);
  });

  test.skip('DELETE /sessions/:id — 204；outbox_events 可查到 session.deleted', async () => {
    const tenant = 91_004;
    const mysqlUrl = process.env['AGENTIC_ENGINE_MYSQL_URL'];
    if (!mysqlUrl) {
      throw new Error('AGENTIC_ENGINE_MYSQL_URL required to assert outbox row');
    }

    const created = await fetch(`${BASE}/sessions`, {
      method:  'POST',
      headers: mockHeaders(tenant, 'integ-user-del'),
      body:    JSON.stringify({ agentId: '18203000000000123' }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const del = await fetch(`${BASE}/sessions/${id}`, {
      method:  'DELETE',
      headers: mockHeaders(tenant, 'integ-user-del'),
    });
    expect(del.status).toBe(204);

    const pool = createPool(mysqlUrl);
    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT event_type, payload_json FROM outbox_events
         WHERE tenant = ? AND event_type = 'session.deleted' AND deleted = 0
         ORDER BY create_time DESC LIMIT 20`,
        [tenant],
      );

      const hit = rows.some((r) => {
        const p = parsePayload(r);
        return p['sessionId'] === id || p['sessionId'] === String(id);
      });
      expect(hit).toBe(true);
    } finally {
      await pool.end();
    }
  });
});

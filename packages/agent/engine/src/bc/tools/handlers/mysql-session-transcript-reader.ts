/**
 * MySQL adapter for SessionTranscriptReader — 与 listMessages 同源 messages 表。
 */
import type { Pool, RowDataPacket } from "mysql2/promise";

import type { SessionRecallRole, SessionTranscriptRow } from "./session-recall";
import type { SessionTranscriptReader } from "./session-recall-handler";

function epochMsFromSql(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  return 0;
}

/** 从 message-content-v1 / blocks 数组抽出纯文本。 */
export function extractTextFromContentJson(contentJson: unknown): string {
  let raw: unknown = contentJson;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return raw as string;
    }
  }
  if (raw == null) return "";
  if (typeof raw === "string") return raw;

  const blocks: unknown[] =
    raw != null && typeof raw === "object" && !Array.isArray(raw) && Array.isArray((raw as { blocks?: unknown }).blocks)
      ? (raw as { blocks: unknown[] }).blocks
      : Array.isArray(raw)
        ? raw
        : [];

  const parts: string[] = [];
  for (const b of blocks) {
    if (b == null || typeof b !== "object") continue;
    const o = b as { type?: unknown; text?: unknown };
    if (o.type === "text" && typeof o.text === "string") parts.push(o.text);
  }
  if (parts.length > 0) return parts.join("\n");

  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

function asRole(raw: string): SessionRecallRole {
  if (raw === "user" || raw === "assistant" || raw === "system" || raw === "tool") return raw;
  return "assistant";
}

export class MysqlSessionTranscriptReader implements SessionTranscriptReader {
  constructor(private readonly pool: Pool | null) {}

  async listBySession(params: { tenant: number; sessionId: string; limit: number }): Promise<SessionTranscriptRow[]> {
    if (!this.pool) return [];

    const limit = Math.min(Math.max(params.limit, 1), 200);
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT id, turn_id, seq, role, content_json, create_time
       FROM messages
       WHERE tenant = ? AND session_id = ? AND deleted = 0
       ORDER BY create_time ASC, seq ASC
       LIMIT ?`,
      [params.tenant, BigInt(params.sessionId), limit],
    );

    return rows.map((r) => ({
      id: String(r.id),
      turnId: String(r.turn_id),
      role: asRole(String(r.role)),
      text: extractTextFromContentJson(r.content_json),
      createTime: epochMsFromSql(r.create_time),
    }));
  }
}

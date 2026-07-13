/**
 * session_recall — 同 session MySQL transcript 按需装配（ADR-0036）。
 * 纯函数：给定已加载的行 + 预算，产出 full / summary 结果。
 */

export type SessionRecallRole = "user" | "assistant" | "system" | "tool";

export interface SessionTranscriptRow {
  id: string;
  turnId: string;
  role: SessionRecallRole;
  text: string;
  createTime: number;
}

export interface SessionRecallMessage {
  id: string;
  turnId: string;
  role: SessionRecallRole;
  text: string;
  createTime: number;
}

export interface SessionRecallInput {
  /** 子串过滤（大小写不敏感）；缺省不过滤 */
  query?: string;
  /** 返回正文总字符预算；超出则 summary。默认 32000 */
  maxChars?: number;
  /** 最多取多少条（从旧到新加载后再裁）；默认 200 */
  limit?: number;
}

export interface SessionRecallOutput {
  mode: "full" | "summary";
  truncated: boolean;
  messages: SessionRecallMessage[];
}

export const SESSION_RECALL_DEFAULT_MAX_CHARS = 32_000;
export const SESSION_RECALL_DEFAULT_LIMIT = 200;
const SUMMARY_PREVIEW_CHARS = 240;

function normalizeQuery(query: string | undefined): string | undefined {
  const q = query?.trim();
  return q && q.length > 0 ? q.toLowerCase() : undefined;
}

function applyQueryFilter(rows: readonly SessionTranscriptRow[], query: string | undefined): SessionTranscriptRow[] {
  const q = normalizeQuery(query);
  if (!q) return [...rows];
  return rows.filter((r) => r.text.toLowerCase().includes(q));
}

function totalChars(messages: readonly SessionRecallMessage[]): number {
  return messages.reduce((acc, m) => acc + m.text.length, 0);
}

function toMessage(row: SessionTranscriptRow): SessionRecallMessage {
  return {
    id: row.id,
    turnId: row.turnId,
    role: row.role,
    text: row.text,
    createTime: row.createTime,
  };
}

/**
 * 近端优先：从最新往旧尽量保留全文，预算不够的旧消息压成预览。
 */
function summarizeToBudget(messages: SessionRecallMessage[], maxChars: number): SessionRecallMessage[] {
  const out: SessionRecallMessage[] = messages.map((m) => ({ ...m }));
  let used = totalChars(out);
  if (used <= maxChars) return out;

  for (let i = 0; i < out.length && used > maxChars; i++) {
    const m = out[i]!;
    if (m.text.length <= SUMMARY_PREVIEW_CHARS) continue;
    const preview = `${m.text.slice(0, SUMMARY_PREVIEW_CHARS)}…`;
    used -= m.text.length - preview.length;
    out[i] = { ...m, text: preview };
  }

  // 仍超预算：从最旧开始清空正文（保留元数据占位）
  for (let i = 0; i < out.length && used > maxChars; i++) {
    const m = out[i]!;
    if (m.text.length === 0) continue;
    used -= m.text.length;
    out[i] = { ...m, text: `[omitted ${m.text.length} chars]` };
    used += out[i]!.text.length;
  }

  return out;
}

export function assembleSessionRecall(rows: readonly SessionTranscriptRow[], input: SessionRecallInput): SessionRecallOutput {
  const maxChars = Math.max(1, input.maxChars ?? SESSION_RECALL_DEFAULT_MAX_CHARS);
  const limit = Math.min(Math.max(input.limit ?? SESSION_RECALL_DEFAULT_LIMIT, 1), 200);

  const filtered = applyQueryFilter(rows, input.query);
  const sliced = filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
  const messages = sliced.map(toMessage);
  const chars = totalChars(messages);

  if (chars <= maxChars) {
    return { mode: "full", truncated: false, messages };
  }

  return {
    mode: "summary",
    truncated: true,
    messages: summarizeToBudget(messages, maxChars),
  };
}

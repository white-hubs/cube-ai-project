/**
 * Normalize `turn-failed-v1` event into a small typed summary.
 * Ported from ghcloud `assistant-chat.utils.ts` (ADR-0008 §D5.7)：
 *   - 解析 `error.message` / `error.code` / 顶层 `message`/`errorMessage`/`code`
 *   - 兼容服务端把整条 zod issues 数组 `[{ message, ... }]` 当 message 抛出的情况
 *   - **不**做截字符 / **不**拼"发送失败："前缀 / **不**做 i18n —— 业务自定
 */
import { getDataString } from './content';
import type { TurnFailureSummary } from '../types';

/** 旧 API 兼容：仅返回 raw message string（与 ghcloud `extractTurnFailedMessage` 等价）。 */
export function extractTurnFailedMessage(
  data: Record<string, unknown>,
): string {
  const err = data.error;
  if (err != null && typeof err === 'object' && !Array.isArray(err)) {
    const o = err as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim() !== '') {
      return o.message.trim();
    }
    if (typeof o.code === 'string' && o.code.trim() !== '') {
      return o.code.trim();
    }
  }
  return (
    getDataString(data, ['message', 'errorMessage', 'code']) || '本轮对话失败'
  );
}

/**
 * 完整归一化：拆 zod JSON 数组 `[0].message`，但不截字 / 不拼前缀 / 不翻译。
 * UI 业务侧自行 slice / line-clamp。
 */
export function extractTurnFailureSummary(
  data: Record<string, unknown>,
): TurnFailureSummary {
  let message = extractTurnFailedMessage(data);
  let code: string | null = null;

  const err = data.error;
  if (err != null && typeof err === 'object' && !Array.isArray(err)) {
    const o = err as Record<string, unknown>;
    if (typeof o.code === 'string' && o.code.trim() !== '') {
      code = o.code.trim();
    }
  }
  if (code == null) {
    const fallbackCode = getDataString(data, ['code', 'errorCode']);
    if (fallbackCode !== '') code = fallbackCode.trim();
  }

  // 兼容 "[{...zod issues...}]" 字符串
  const trimmed = message.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0];
        if (first != null && typeof first === 'object') {
          const msg = (first as { message?: string }).message;
          if (typeof msg === 'string' && msg.trim() !== '') {
            message = msg.trim();
          }
        }
      }
    } catch {
      /* 保留原文 */
    }
  }

  return { code, message, raw: err ?? data };
}
